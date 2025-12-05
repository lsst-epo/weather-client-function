import { 
    weatherStatsHandler, 
    processStats, 
    extractCurrent, 
    cacheResult,
    fetchMeteoblueData,
    getConfig
} from './index';
import {jest, test} from '@jest/globals';
import * as ff from '@google-cloud/functions-framework';
import axios from 'axios';
import 'dotenv/config'


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

const req = {
    query: {mode: "current"}
} as unknown as ff.Request; // "as unknown as" is a double-cast trick to force partial object into strict type

const res = {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
    send: jest.fn().mockReturnThis(),
} as unknown as ff.Response;

describe('Weather stats', () => {
    const ENV = process.env;
    beforeEach(() => {
        jest.useFakeTimers().setSystemTime(new Date("2025-12-01 01:30"));
        process.env = ENV;
    })
    afterEach(() => {
        jest.useRealTimers();
    })
    describe('env variables', () => {
        it('should use env vars if defined', () => {
            process.env.METEOBLUE_BASIC_API = 'blah';
            process.env.METOBLUE_CLOUD_API = 'blah';
            const basic_env = process.env.METEOBLUE_BASIC_API || 'https://my.meteoblue.com/packages/basic-1h';
            const cloud_env = process.env.METOBLUE_CLOUD_API || '"https://my.meteoblue.com/packages/clouds-1h';
            expect(basic_env).toBe('blah');
            expect(cloud_env).toBe('blah');
        });

        it('should ues correct defaults', () => {
            delete process.env.METEOBLUE_BASIC_API;

            const config = getConfig();

            expect(config.endpoints.BASIC_1H_ENDPOINT).toBe(
                "https://my.meteoblue.com/packages/basic-1h"
            );
        })

    })
    describe('fetchMeteoblueData()', () => {
        it('propagates errors on API error', async () => {
            const mockError = new Error('Error');
            mockedAxios.get.mockRejectedValueOnce(mockError);

            await expect(fetchMeteoblueData('https://my.meteoblue.com/packages/basic-1h')).rejects.toThrow('Error');
        });

        it('should use default value for history and forecast days', async () => {
            delete process.env.HISTORY_DAYS;
            delete process.env.FORECAST_DAYS;

            mockedAxios.get.mockResolvedValue({
                data: {"success": true}
            })

            await fetchMeteoblueData('https://my.meteoblue.com/packages/basic-1h');
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
            // jest.useFakeTimers().setSystemTime(new Date("2025-12-01 01:30"));
            const result = extractCurrent(mockedMeteoblueBasicResponseSuccess as any);

            expect(result.time).toBe("2025-12-01 02:00");
        })

        it('defaults to last index if current time is out of  range', () => {
            jest.useFakeTimers().setSystemTime(new Date("2026-01-01 00:00"));
            const result = extractCurrent(mockedMeteoblueBasicResponseSuccess as any);

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
            // let malformedMockData = mockedMeteoblueBasicResponseSuccess;

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

            // expect(result.time).toBe("2025-12-01 02:00");
            expect(result.temperature).toBe(undefined);
        })
    })
    // TODO: fill this out more
    describe('processStats()', () => {
        it('fetches data, extracts mode, caches result', async () => {
            mockedAxios.get.mockResolvedValueOnce({ data: mockedMeteoblueBasicResponseSuccess });
            mockedAxios.post.mockResolvedValueOnce({ status: 200 }) // for redis cache

            const result = await processStats(req, res, ENV.METEOBLUE_BASIC_API || 'https://my.meteoblue.com/packages/basic-1h', 'http://basic_cache_api');

            expect(res.json).toHaveBeenCalled();
        })

        it('fetches data, extracts mode, caches result', async () => {
            mockedAxios.get.mockResolvedValueOnce({ data: mockedMeteoblueBasicResponseSuccess });
            mockedAxios.post.mockResolvedValueOnce({ status: 200 }) // for redis cache
            const req = {
                query: {mode: "full_history"}
            } as unknown as ff.Request;

            const result = await processStats(req, res, ENV.METEOBLUE_BASIC_API || 'https://my.meteoblue.com/packages/basic-1h', 'http://basic_cache_api');

            expect(res.json).toHaveBeenCalled();
        })
    })

    describe('weatherStatsHandler', () => {
        const mockRes = () => {
            const res: any = {};
            res.status = jest.fn().mockReturnValue(res);
            res.send = jest.fn().mockReturnValue(res);
            res.json = jest.fn().mockReturnValue(res);
            return res;
        }
        it('routes /basic-stats to processStats', async () => {
            mockedAxios.get.mockResolvedValueOnce({ data: mockedMeteoblueBasicResponseSuccess});

            const req = { path: "/basic-stats", query: {mode: "current"}} as any;
            const res = mockRes();

            await weatherStatsHandler(req, res);

            expect(res.json).toHaveBeenCalled();

            // check if correct endpoint
            expect(mockedAxios.get).toHaveBeenCalledWith(
                expect.stringContaining('basic'),
                expect.any(Object)
            )
        });

        it('routes /basic-stats to processStats without explicit mode', async () => {
            mockedAxios.get.mockResolvedValueOnce({ data: mockedMeteoblueBasicResponseSuccess});

            const req = { path: "/basic-stats"} as any;
            const res = mockRes();

            await weatherStatsHandler(req, res);

            expect(res.json).toHaveBeenCalled();

            // check if correct endpoint
            expect(mockedAxios.get).toHaveBeenCalledWith(
                expect.stringContaining('basic'),
                expect.any(Object)
            )
        });

        it('routes /cloud-stats to processStats', async () => {
            mockedAxios.get.mockResolvedValueOnce({ data: mockedMeteoblueCloudResponseSuccess});

            const req = { path: "/cloud-stats", query: {mode: "current"}} as any;
            const res = mockRes();

            await weatherStatsHandler(req, res);
            
            expect(res.json).toHaveBeenCalled();

            // check if correct endpoint
            expect(mockedAxios.get).toHaveBeenCalledWith(
                expect.stringContaining('cloud'),
                expect.any(Object)
            )
        })

        it('routes /cloud-stats to processStats without explicit mode', async () => {
            mockedAxios.get.mockResolvedValueOnce({ data: mockedMeteoblueCloudResponseSuccess});

            const req = { path: "/cloud-stats"} as any;
            const res = mockRes();

            await weatherStatsHandler(req, res);
            
            expect(res.json).toHaveBeenCalled();

            // check if correct endpoint
            expect(mockedAxios.get).toHaveBeenCalledWith(
                expect.stringContaining('cloud'),
                expect.any(Object)
            )
        })

        it('routes / to processStats', async () => {
            mockedAxios.get.mockResolvedValueOnce({ data: mockedMeteoblueCloudResponseSuccess});

            const req = { path: "/"} as any;
            const res = mockRes();

            await weatherStatsHandler(req, res);
            
            // check if correct endpoint
            expect(mockedAxios.get).toHaveBeenCalledWith(
                expect.stringContaining(''),
                expect.any(Object)
            )
        })

        it('returns 400 for unknown paths', async () => {
            const req = { path: '/unknown' } as any;
            const res = mockRes();
    
            await weatherStatsHandler(req, res);
    
            expect(res.status).toHaveBeenCalledWith(400);
        });

        it('still returns if cache fails', async () => {
            mockedAxios.get.mockResolvedValueOnce({ data: mockedMeteoblueCloudResponseSuccess });
            mockedAxios.post.mockRejectedValueOnce(new Error("Cache Down"));
            
            // suppress output during test and verify it was called
            const consoleSpy = jest.spyOn(console, 'warn').mockImplementation(()=>{});
            await expect(processStats(req, res, 'https://my.meteoblue.com/packages/basic-1h', 'http://basic_cache_api'))
                .resolves.not.toThrow();

            expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("Cache upload error: Cache Down"));
            consoleSpy.mockRestore();
        })
    })

    

});