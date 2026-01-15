import 'dotenv/config'
import * as ff from '@google-cloud/functions-framework';
import axios from "axios";

interface MeteoblueMetadata {
    modelrun_updatetime_utc: string;
    name: string;
    height: number;
    timezone_abbrevation: string;
    latitude: number;
    modelrun_utc: string;
    longitude: number;
    utc_timeoffset: number;
    generation_time_ms: number;
    [key: string]: any;
}

interface MeteoblueUnits {
    [key: string]: string;
}

interface MeteoblueBasicHourlyData {
    time: string[];
    snowfraction: number[];
    windspeed: number[];
    temperature: number[];
    precipitation_probability: number[];
    convective_precipitation: number[];
    rainspot: string[];
    pictocode: number[];
    felttemperature: number[];
    precipitation: number[];
    isdaylight: number[];
    uvindex: number[];
    relativehumidity: number[];
    sealevelpressure: number[];
    winddirection: number[];
    [key: string]: any[];
}

interface MeteoblueCloudsHourlyData {
    time: string[];
    totalcloudcover: number[];
    fog_probability: number[];
    highclouds: number[];
    lowclouds: number[];
    visibility: number[];
    midclouds: number[];
    sunshinetime: number[];
    [key: string]: any[];
}

interface MeteoblueBaseResponse {
    metadata: MeteoblueMetadata;
    units: MeteoblueUnits;
    data_1h: {
        time: string[];
        [key:string]: any[] | any;
    }
}

interface MeteoblueBasicHourlyResponse extends MeteoblueBaseResponse{
    metadata: MeteoblueMetadata;
    units: MeteoblueUnits;
    data_1h: MeteoblueBasicHourlyData;
}

interface MeteoblueCloudsHourlyResponse extends MeteoblueBaseResponse{
    metadata: MeteoblueMetadata;
    units: MeteoblueUnits;
    data_1h: MeteoblueCloudsHourlyData;
}

export const getConfig = () => {
    return {
        endpoints: {
            BASIC_1H_ENDPOINT: process.env.METEOBLUE_BASIC_API as string,
            CLOUD_1H_ENDPOINT: process.env.METEOBLUE_CLOUD_API as string,
            CURRENT_ENDPOINT: process.env.METEOBLUE_CURRENT_API as string,
            BASIC_CACHE_ENDPOINT: process.env.BASIC_CACHE_ENDPOINT as string,
            CLOUD_CACHE_ENDPOINT: process.env.CLOUD_CACHE_ENDPOINT as string,
            CURRENT_CACHE_ENDPOINT: process.env.CURRENT_CACHE_ENDPOINT as string
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
            cache_endpoint, payload
        )
    } catch (error: any) {
        console.warn(`Cache upload error: ${error.message}`)
    }
}

export async function processStats(req: ff.Request, res: ff.Response, cloudEndpoint: string, cacheEndpoint: string) {
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