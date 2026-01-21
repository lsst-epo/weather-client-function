import { 
    weatherStatsHandler, 
    processStats, 
    extractCurrent, 
    fetchMeteoblueData,
    cacheResult,
    getConfig
} from './index';
import {jest} from '@jest/globals';
import * as ff from '@google-cloud/functions-framework';
import axios from 'axios';
import 'dotenv/config';
import { createRequest, createResponse, MockRequest, MockResponse } from 'node-mocks-http';


jest.mock('axios'); // mock axios globally at top level to prevent accidental network calls

const mockedAxios = axios as jest.Mocked<typeof axios>

// sample mocked api responses
const mockedMeteoblueBasicResponseSuccess = {
    metadata: {
        "modelrun_updatetime_utc": "2025-12-03 17:09",
        "name": "Rubin",
        "height": 2647,
        "timezone_abbrevation": "GMT-03",
        "latitude": -30.24493,
        "modelrun_utc": "2025-12-03 17:09",
        "longitude": -70.74902,
        "utc_timeoffset": -3.0,
        "generation_time_ms": 7.9199076
    },
    units: { temperature: "C" },
    data_1h: {
        time: ["2025-12-01 01:00", "2025-12-01 02:00", "2025-12-01 03:00"],
        temperature: [10, 12, 15]
    }
};

const mockedMeteoblueCloudResponseSuccess = {
    metadata: {
        "modelrun_updatetime_utc": "2025-12-03 17:09",
        "name": "Rubin",
        "height": 2647,
        "timezone_abbrevation": "GMT-03",
        "latitude": -30.24493,
        "modelrun_utc": "2025-12-03 17:09",
        "longitude": -70.74902,
        "utc_timeoffset": -3.0,
        "generation_time_ms": 7.9199076
    },
    units: { cloudcover: "percent" },
    data_1h: {
        time: ["2025-12-01 01:00", "2025-12-01 02:00", "2025-12-01 03:00"],
        totalcloudcover: [0, 5, 55]
    }
};


describe('Weather stats', () => {
    const ENV = process.env;
    let REDIS_CACHE_TOKEN: string;
    let AUTH_TOKEN: string;

    let req: MockRequest<ff.Request>;
    let res: MockResponse<ff.Response>;

    beforeEach(() => {
        jest.useFakeTimers().setSystemTime(new Date("2025-12-01 01:30"));

        const config = getConfig();
        REDIS_CACHE_TOKEN = config.tokens.REDIS_CACHE_TOKEN as string;
        AUTH_TOKEN = config.tokens.AUTH_TOKEN as string;
        jest.clearAllMocks();
        process.env = ENV;

        req = createRequest({
            method: 'GET',
            query: {
                mode: "current"
            }
        }) as MockRequest<ff.Request>;
        res = createResponse() as MockResponse<ff.Response>;
    })
    afterEach(() => {
        jest.useRealTimers();
    })

    describe('fetchMeteoblueData()', () => {
        it('propagates errors on API error', async () => {
            const mockError = new Error('Error');
            mockedAxios.get.mockRejectedValueOnce(mockError);

            await expect(fetchMeteoblueData(ENV.METEOBLUE_BASIC_API as string)).rejects.toThrow('Error');
        });

        it('should use default value for history and forecast days', async () => {
            delete process.env.HISTORY_DAYS;
            delete process.env.FORECAST_DAYS;

            mockedAxios.get.mockResolvedValueOnce({
                data: {"success": true}
            })

            await fetchMeteoblueData(ENV.METEOBLUE_BASIC_API as string);
            expect(mockedAxios.get).toHaveBeenCalledWith(
                expect.any(String),
                expect.objectContaining({
                    params: expect.objectContaining({
                        history_days: 1, // Should default to 1
                        forecast_days: 1 
                    })
                })
            );
        });
    })
    describe('extractCurrent()', () => {
        it('finds correct time slot if current time is within range', () => {
            const result = extractCurrent(mockedMeteoblueBasicResponseSuccess);

            expect(result.time).toBe("2025-12-01 02:00");
        })

        it('defaults to last index if current time is out of  range', () => {
            jest.useFakeTimers().setSystemTime(new Date("2026-01-01 00:00"));
            const result = extractCurrent(mockedMeteoblueBasicResponseSuccess);

            expect(result.time).toBe("2025-12-01 03:00");
        })

        it('extract current returns correct result even if value array length is less than targetIndex', () => {
            let malformedMockData = mockedMeteoblueBasicResponseSuccess;
            malformedMockData.data_1h.temperature = [10, 20];

            const result = extractCurrent(malformedMockData);

            expect(result.time).toBe("2025-12-01 02:00");
            expect(result.temperature).toBe(20);
        })

        it('extract current returns correct result even if undefined', () => {
            const mockedMeteoblueCloudResponseSuccessFake = {
                metadata: {
                    "modelrun_updatetime_utc": "2025-12-03 17:09",
                    "name": "Rubin",
                    "height": 2647,
                    "timezone_abbrevation": "GMT-03",
                    "latitude": -30.24493,
                    "modelrun_utc": "2025-12-03 17:09",
                    "longitude": -70.74902,
                    "utc_timeoffset": -3.0,
                    "generation_time_ms": 7.9199076
                },
                units: { cloudcover: "percent" },
                data_1h: {
                    time: ["2025-12-01 01:00", "2025-12-01 02:00", "2025-12-01 03:00"],
                    totalcloudcover: [0, 5, 55],
                    fakeField: undefined
                }
            };

            const result = extractCurrent(mockedMeteoblueCloudResponseSuccessFake);

            expect(result.temperature).toBe(undefined);
        })
    })
    describe('processStats()', () => {
        it('fetches data, caches result', async () => {
            mockedAxios.get.mockResolvedValueOnce({ data: mockedMeteoblueBasicResponseSuccess });
            mockedAxios.post.mockResolvedValueOnce({ status: 200 }) // for redis cache

            const data = await processStats(ENV.METEOBLUE_BASIC_API as string, ENV.BASIC_CACHE_ENDPOINT as string);
            expect(data).toBeDefined();
            expect(data).toHaveProperty('units');

            expect(mockedAxios.post).toHaveBeenCalled();
        })
    })

    describe('weatherStatsHandler', () => {
        it('routes /basic-stats to processStats', async () => {
            mockedAxios.get.mockResolvedValueOnce({ data: mockedMeteoblueBasicResponseSuccess});

            const req = createRequest({
                method: 'GET',
                url: '/basic-stats',
                query: {mode: "current"}, 
                headers: { authorization: `Bearer ${AUTH_TOKEN}` }
            }) as ff.Request;

            await weatherStatsHandler(req, res);

            expect(res._getStatusCode()).toBe(200);

            const responseData = res._getJSONData();
            expect(responseData).toHaveProperty('data');

            // check if correct endpoint
            expect(mockedAxios.get).toHaveBeenCalledWith(
                expect.stringContaining('current'),
                expect.any(Object)
            )
        });

        it('routes /basic-stats to processStats without explicit mode', async () => {
            mockedAxios.get.mockResolvedValueOnce({ data: mockedMeteoblueBasicResponseSuccess});

            const req = createRequest({
                method: 'GET',
                url: '/basic-stats',
                headers: { authorization: `Bearer ${AUTH_TOKEN}` }
            }) as ff.Request;

            await weatherStatsHandler(req, res);

            expect(res._getStatusCode()).toBe(200);

            const responseData = res._getJSONData();
            expect(responseData).toHaveProperty('data');

            // check if correct endpoint
            expect(mockedAxios.get).toHaveBeenCalledWith(
                expect.stringContaining('current'),
                expect.any(Object)
            )
        });

        it('routes /forecasted-basic-stats to processStats without explicit mode', async () => {
            mockedAxios.get.mockResolvedValueOnce({ data: mockedMeteoblueBasicResponseSuccess});
            const req = createRequest({
                method: 'GET',
                url: '/forecasted-basic-stats',
                headers: { authorization: `Bearer ${AUTH_TOKEN}` }
            }) as ff.Request;

            await weatherStatsHandler(req, res);

            expect(res._getStatusCode()).toBe(200);

            const responseData = res._getJSONData();
            expect(responseData).toHaveProperty('data');

            // check if correct endpoint
            expect(mockedAxios.get).toHaveBeenCalledWith(
                expect.stringContaining('basic'),
                expect.any(Object)
            )
        });

        it('routes /forecasted-cloud-stats to processStats', async () => {
            mockedAxios.get.mockResolvedValueOnce({ data: mockedMeteoblueCloudResponseSuccess});

            const req = createRequest({
                method: 'GET',
                url: '/forecasted-cloud-stats',
                query: { mode: "current" },
                headers: { authorization: `Bearer ${AUTH_TOKEN}` }
            }) as ff.Request;

            await weatherStatsHandler(req, res);
            
            expect(res._getStatusCode()).toBe(200);

            const responseData = res._getJSONData();
            expect(responseData).toHaveProperty('data');

            // check if correct endpoint
            expect(mockedAxios.get).toHaveBeenCalledWith(
                expect.stringContaining('cloud'),
                expect.any(Object)
            )
        })

        it('routes /forecasted-cloud-stats to processStats without explicit query', async () => {
            mockedAxios.get.mockResolvedValueOnce({ data: mockedMeteoblueCloudResponseSuccess});

            const req = createRequest({
                method: 'GET',
                url: '/forecasted-cloud-stats',
                headers: { authorization: `Bearer ${AUTH_TOKEN}` }
            }) as ff.Request;

            const querylessReq = Object.assign({}, req, { query: undefined }) as ff.Request; // This is to remove the query that comes by default and is required

            await weatherStatsHandler(querylessReq, res);
            
            expect(res._getStatusCode()).toBe(200);

            const responseData = res._getJSONData();
            expect(responseData).toHaveProperty('data');

            // check if correct endpoint
            expect(mockedAxios.get).toHaveBeenCalledWith(
                expect.stringContaining('cloud'),
                expect.any(Object)
            )
        })

        it('routes /forecasted-cloud-stats to processStats without explicit query.mode', async () => {
            mockedAxios.get.mockResolvedValueOnce({ data: mockedMeteoblueCloudResponseSuccess});

            const req = createRequest({
                method: 'GET',
                url: '/forecasted-cloud-stats',
                headers: { authorization: `Bearer ${AUTH_TOKEN}` }
            }) as ff.Request;

            await weatherStatsHandler(req, res);
            
            expect(res._getStatusCode()).toBe(200);

            const responseData = res._getJSONData();
            expect(responseData).toHaveProperty('data');

            // check if correct endpoint
            expect(mockedAxios.get).toHaveBeenCalledWith(
                expect.stringContaining('cloud'),
                expect.any(Object)
            )
        })

        it('routes / to processStats', async () => {
            mockedAxios.get.mockResolvedValueOnce({ data: mockedMeteoblueCloudResponseSuccess});

            const req = createRequest({
                method: 'GET',
                url: '/',
                headers: { authorization: `Bearer ${AUTH_TOKEN}` }
            }) as ff.Request;

            await weatherStatsHandler(req, res);
            
            // check if correct endpoint
            expect(res._getStatusCode()).toBe(200);
            expect(res._getData()).toBe("🐈‍⬛");
        })

        it('returns 400 for unknown paths', async () => {
            const req = createRequest({
                method: 'GET',
                url: '/unknown',
                headers: { authorization: `Bearer ${AUTH_TOKEN}` }
            }) as ff.Request;
            await weatherStatsHandler(req, res);
            expect(res._getStatusCode()).toBe(400);
        });

        it('returns 401 missing bearer token', async () => {
            const req = createRequest({
                method: 'GET',
                url: '/',
            }) as ff.Request;
            await weatherStatsHandler(req, res);
            expect(res._getStatusCode()).toBe(401);
        });

        it('returns 401 invalid bearer token', async () => {
            const req = createRequest({
                method: 'GET',
                url: '/',
                headers: { authorization: `Bearer wrong_token` }
            }) as ff.Request;
            await weatherStatsHandler(req, res);
            expect(res._getStatusCode()).toBe(401);
        });

        it('still returns if cache fails', async () => {
            mockedAxios.get.mockResolvedValueOnce({ data: mockedMeteoblueCloudResponseSuccess });
            mockedAxios.post.mockRejectedValueOnce(new Error("Cache Down"));
            
            // suppress output during test and verify it was called
            const consoleSpy = jest.spyOn(console, 'warn').mockImplementation(()=>{});
            await expect(processStats(ENV.METEOBLUE_BASIC_API as string, ENV.BASIC_CACHE_ENDPOINT as string))
                .resolves.not.toThrow();

            expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("Cache upload error: Cache Down"));
            consoleSpy.mockRestore();
        })
    })

    describe('cacheResult', () => {
        it('log plain string when the error is not an Error object', async () => {
            const stringError = "String error"; // not an Error object, just a string
            mockedAxios.post.mockRejectedValueOnce(stringError);
        
            // suppress output during test and verify it was called
            const consoleSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
        
            const sampleData = { units: {}, time: "2026-01-01" };
            await cacheResult('endpoint', 'cache_url', 'params', sampleData);
        
            expect(consoleSpy).toHaveBeenCalledWith(`Cache upload error: ${stringError}`);
            consoleSpy.mockRestore();
        });
    })
});