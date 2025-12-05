import { 
    weatherStatsHandler, 
    processStats, 
    extractCurrent, 
    cacheResult 
} from './index';
import axios from 'axios';

jest.mock('axios'); // mock axios globally at top level to prevent accidental network calls
const mockedAxios = axios as jest.Mocked<typeof axios>

// sample mocked api responses
const mockedMeteoblueBasicResponseSuccess = {
    metadata: {},
    units: { temperature: "C"},
    data_1h: {
        time: ["2025-12-01 01:00", "2025-12-01 02:00", "2025-12-01 03:00"],
        temperature: [10, 12, 15]
    }
};

describe('Weather stats', () => {

    describe('extractCurrent()', () => {
        it('finds correct time slot', () => {
            jest.useFakeTimers().setSystemTime(new Date("2025-12-01 01:30"));
            const result = extractCurrent(mockedMeteoblueBasicResponseSuccess as any);

            expect(result.time).toBe("2025-12-01 02:00");
        })
    })

});