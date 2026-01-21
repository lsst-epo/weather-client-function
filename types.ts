export interface MeteoblueMetadata {
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

export interface MeteoblueUnits {
    [key: string]: string;
}

export interface MeteoblueBasicHourlyData {
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

export interface MeteoblueCloudsHourlyData {
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

export interface MeteoblueBaseResponse {
    metadata: MeteoblueMetadata;
    units: MeteoblueUnits;
    data_1h: {
        time: string[];
        [key:string]: any[] | any;
    }
}

export interface MeteoblueBasicHourlyResponse extends MeteoblueBaseResponse{
    metadata: MeteoblueMetadata;
    units: MeteoblueUnits;
    data_1h: MeteoblueBasicHourlyData;
}

export interface MeteoblueCloudsHourlyResponse extends MeteoblueBaseResponse{
    metadata: MeteoblueMetadata;
    units: MeteoblueUnits;
    data_1h: MeteoblueCloudsHourlyData;
}

export interface MeteoblueCurrentSlice {
    time: string;
    units: MeteoblueUnits;
    [key: string]: string | number | MeteoblueUnits; 
}