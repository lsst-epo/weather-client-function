import { 
    weatherStatsHandler, 
    processStats, 
    extractCurrent, 
    cacheResult,
    fetchMeteoblueData
} from './index';
import {jest, test} from '@jest/globals';
import * as ff from '@google-cloud/functions-framework';
import axios from 'axios';
import 'dotenv/config'


jest.mock('axios'); // mock axios globally at top level to prevent accidental network calls

const mockedAxios = axios as jest.Mocked<typeof axios>

// sample mocked api responses
const mockedMeteoblueBasicResponseSuccess = {
    metadata: {},
    units: { temperature: "C" },
    data_1h: {
        time: ["2025-12-01 01:00", "2025-12-01 02:00", "2025-12-01 03:00"],
        temperature: [10, 12, 15]
    }
};

const mockedMeteoblueCloudResponseSuccess = {
    metadata: {},
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
    describe('fetchMeteoblueData()', () => {
        it('propagates errors on API error', async () => {
            const mockError = new Error('Error');
            mockedAxios.get.mockRejectedValueOnce(mockError);

            await expect(fetchMeteoblueData('https://my.meteoblue.com/packages/basic-1h')).rejects.toThrow('Error');
        })
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
    })
    // TODO: fill this out more
    describe('processWeatherRequest()', () => {
        it('fetches data, extracts mode, caches result', async () => {
            mockedAxios.get.mockResolvedValueOnce({ data: mockedMeteoblueBasicResponseSuccess });
            mockedAxios.post.mockResolvedValueOnce({ status: 200 }) // for redis cache

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