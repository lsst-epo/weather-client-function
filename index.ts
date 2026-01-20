import 'dotenv/config'
import * as ff from '@google-cloud/functions-framework';
import axios from "axios";
import { MeteoblueMetadata, MeteoblueUnits, MeteoblueBasicHourlyData, MeteoblueCloudsHourlyData, MeteoblueBaseResponse, MeteoblueBasicHourlyResponse, MeteoblueCloudsHourlyResponse } from './types';

export const getConfig = () => {
    return {
        endpoints: {
            BASIC_1H_ENDPOINT: process.env.METEOBLUE_BASIC_API as string,
            CLOUD_1H_ENDPOINT: process.env.METEOBLUE_CLOUD_API as string,
            CURRENT_ENDPOINT: process.env.METEOBLUE_CURRENT_API as string,
            BASIC_CACHE_ENDPOINT: process.env.BASIC_CACHE_ENDPOINT as string,
            CLOUD_CACHE_ENDPOINT: process.env.CLOUD_CACHE_ENDPOINT as string,
            CURRENT_CACHE_ENDPOINT: process.env.CURRENT_CACHE_ENDPOINT as string
        },
        tokens: {
            AUTH_TOKEN: process.env.AUTH_TOKEN as string,
            REDIS_CACHE_TOKEN: process.env.REDIS_CACHE_TOKEN as string
        }
    };
};

const { 
    BASIC_1H_ENDPOINT, 
    CLOUD_1H_ENDPOINT, 
    BASIC_CACHE_ENDPOINT, 
    CLOUD_CACHE_ENDPOINT, 
    CURRENT_ENDPOINT, 
    CURRENT_CACHE_ENDPOINT
} = getConfig().endpoints;

const { AUTH_TOKEN, REDIS_CACHE_TOKEN } = getConfig().tokens;

export async function fetchMeteoblueData<T>(endpoint: string): Promise<T> {
    const apiKey = process.env.METEOBLUE_API_KEY;
    const lat = process.env.LAT;
    const lon = process.env.LON;
    const asl = process.env.ASL;
    const tz = process.env.TZ;
    const name = process.env.NAME;
    const format = process.env.FORMAT;
    const historyDays = process.env.HISTORY_DAYS || 1
    const forecastDays = process.env.FORECAST_DAYS || 1;

    try {
        const response = await axios.get(endpoint, {
            params: {
                lat, 
                lon, 
                apikey: apiKey, 
                format, 
                asl, 
                tz, 
                name, 
                history_days: historyDays, 
                forecast_days: forecastDays
            }
        })
        return response.data;
    } catch (error) {
        throw error;
    }
}

export async function cacheResult(endpoint: string, cache_endpoint: string, params: any, data: any) {
    try {
        console.log(`cache_endpoint: ${cache_endpoint},  endpoint: ${endpoint}, params: ${params}, data: ${data},`);
        const payload = { endpoint: endpoint, params: params, data: data }
        await axios.post(
            cache_endpoint, 
            payload,
            {
                headers: {
                    'Authorization': `Bearer ${REDIS_CACHE_TOKEN}`
                }
            }
        )
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.warn(`Cache upload error: ${message}`)
    }
}


export async function processStats(req: ff.Request, res: ff.Response, cloudEndpoint: string, cacheEndpoint: string) {
    // require auth headers
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
        return res.status(401).json({error: "Unauthorized: Missing Bearer Token"});
    }

    const token = authHeader.split(' ')[1];

    if (token !== AUTH_TOKEN as string) {
        return res.status(401).json({error: "Unauthorized: Invalid Token"});
    }

    const mode = req.query?.mode || 'current';
    let data = await fetchMeteoblueData<MeteoblueBaseResponse>(cloudEndpoint);

    let result = data;

    if (mode == 'current' && cloudEndpoint !== CURRENT_ENDPOINT) {
        result = extractCurrent(result);
    }
    await cacheResult(cloudEndpoint, cacheEndpoint, mode, result);
    res.json({data: result})
}



// get nearest hour in the future
export function extractCurrent(data: MeteoblueBaseResponse) {
    const now = new Date();
    const times = data.data_1h.time;

    let targetIndex = times.findIndex(t => new Date(t).getTime() >= now.getTime());

    if (targetIndex === -1) {
        targetIndex = times.length - 1; 
    }

    const currentStats: any = {
        time: times[targetIndex],
        units: data.units
    };

    // do a zip
    for (const [key, values] of Object.entries(data.data_1h)) {
        if (Array.isArray(values) && values.length > targetIndex) {
            currentStats[key] = values[targetIndex];
        }
    }
    return currentStats;
}

export async function weatherStatsHandler (req: ff.Request, res: ff.Response)  {
    if (req.path == "/") {
        return res.status(200).send("🐈‍⬛"); 
    } else if (req.path == "/basic-stats") {
        return processStats(req, res, CURRENT_ENDPOINT, CURRENT_CACHE_ENDPOINT);
    } else if (req.path == "/forecasted-basic-stats") {
        return processStats(req, res, BASIC_1H_ENDPOINT, BASIC_CACHE_ENDPOINT);
    } else if (req.path == "/forecasted-cloud-stats") {
        return processStats(req, res, CLOUD_1H_ENDPOINT, CLOUD_CACHE_ENDPOINT);
    } else {
        return res.status(400).send("Oopsies.");
    }
}

ff.http("weather-stats", weatherStatsHandler);