export interface Config {
  apiKey: string;
  applicationKey?: string;
  defaultStationMac?: string; // Default station MAC address
  seasonStart: number; // Month number (1-12)
  chillHourMin: number; // Minimum temperature for chill hour calculation (F)
  chillHourMax: number; // Maximum temperature for chill hour calculation (F)
  rateLimitDelay?: number; // Time to wait between API calls in milliseconds
}

export interface WeatherData {
  dateutc: number;
  tempf: number;
  [key: string]: any;
}

export interface ChillHourReport {
  totalHours: number;
  chillHours: number;
  date: string;
  percentChillHours: number;
}