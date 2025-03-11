import axios from 'axios';
import { WeatherData } from '../types';

/**
 * Helper function to delay execution
 * @param ms Milliseconds to delay
 */
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

export class AmbientWeatherAPI {
  // API constants
  private static readonly DEFAULT_RATE_LIMIT_DELAY_MS = 1_000; // Default delay between requests (1 second)
  private static readonly DEFAULT_READINGS_PER_DAY = 288; // 288 readings per day (5-minute intervals)
  private static readonly DEFAULT_READINGS_PER_CHUNK = 500; // Typical chunk size from Ambient Weather API
  private static readonly MAX_FETCH_OPERATIONS = 100; // Safety limit to prevent infinite loops
  private static readonly MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1_000;
  private static readonly HTTP_RATE_LIMIT_STATUS = 429;
  private static readonly HTTP_SERVER_ERROR_MIN = 500;
  private static readonly HTTP_SERVER_ERROR_MAX = 599;
  private static readonly DEFAULT_MAX_RETRIES = 3;
  private static readonly ONE_SECOND_MS = 1_000;
  
  private apiKey: string;
  private applicationKey?: string;
  private baseUrl = 'https://api.ambientweather.net/v1';
  private rateLimitDelay: number;
  
  constructor(
    apiKey: string, 
    applicationKey?: string, 
    rateLimitDelay = AmbientWeatherAPI.DEFAULT_RATE_LIMIT_DELAY_MS
  ) {
    this.apiKey = apiKey;
    this.applicationKey = applicationKey;
    this.rateLimitDelay = rateLimitDelay;
  }
  
  /**
   * Makes an API request with retry capability for rate limiting
   * @param url The URL to call
   * @param params Request parameters
   * @param maxRetries Maximum number of retries
   * @returns API response
   */
  private async makeRequest(
    url: string, 
    params: any, 
    maxRetries = AmbientWeatherAPI.DEFAULT_MAX_RETRIES
  ): Promise<any> {
    let retries = 0;
    
    while (true) {
      try {
        const response = await axios.get(url, { params });
        return response.data;
      } catch (error: any) {
        // Check if this is a rate limit error (429) or any other server error (5xx)
        if (this.isRetryableError(error)) {
          if (retries >= maxRetries) {
            console.error(`Failed after ${maxRetries} retries. Last error:`, error.message);
            throw error;
          }
          
          retries++;
          
          // Exponential backoff: wait longer with each retry
          const backoffDelay = this.calculateBackoffDelay(retries);
          console.log(`Rate limit hit, retrying in ${backoffDelay / 1_000} seconds (attempt ${retries}/${maxRetries})...`);
          await sleep(backoffDelay);
          continue;
        }
        
        // For other errors, just throw
        throw error;
      }
    }
  }
  
  /**
   * Checks if an error is retryable (rate limit or server error)
   */
  private isRetryableError(error: any): boolean {
    return error.response && (
      error.response.status === AmbientWeatherAPI.HTTP_RATE_LIMIT_STATUS || 
      (error.response.status >= AmbientWeatherAPI.HTTP_SERVER_ERROR_MIN && 
       error.response.status <= AmbientWeatherAPI.HTTP_SERVER_ERROR_MAX)
    );
  }
  
  /**
   * Calculates backoff delay with exponential increase
   */
  private calculateBackoffDelay(retryCount: number): number {
    return this.rateLimitDelay * Math.pow(2, retryCount - 1);
  }
  
  /**
   * Get the list of available devices
   */
  async getDevices(): Promise<any[]> {
    try {
      const params = this.createBaseParams();
      return await this.makeRequest(`${this.baseUrl}/devices`, params);
    } catch (error) {
      console.error('Error fetching devices:', error);
      throw error;
    }
  }
  
  /**
   * Creates common API parameters used in all requests
   */
  private createBaseParams(): Record<string, any> {
    return {
      apiKey: this.apiKey,
      applicationKey: this.applicationKey
    };
  }
  
  /**
   * Get weather data for a specific device
   * @param macAddress MAC address of the device
   * @param endDate End date for the data
   * @param limit Maximum number of readings to retrieve
   */
  async getDeviceData(
    macAddress: string, 
    endDate?: Date, 
    limit: number = AmbientWeatherAPI.DEFAULT_READINGS_PER_DAY
  ): Promise<WeatherData[]> {
    try {
      const params = this.createRequestParams(endDate, limit);
      return await this.makeRequest(`${this.baseUrl}/devices/${macAddress}`, params);
    } catch (error) {
      console.error('Error fetching device data:', error);
      throw error;
    }
  }
  
  /**
   * Creates params for device data requests
   */
  private createRequestParams(endDate?: Date, limit?: number): Record<string, any> {
    const params = this.createBaseParams();
    
    if (limit) {
      params.limit = limit;
    }
    
    if (endDate) {
      params.endDate = endDate.toISOString();
    }
    
    return params;
  }
  
  /**
   * Fetches device data for a specific date range using multiple API calls
   * 
   * @param macAddress MAC address of the device
   * @param startDate Start date for the data
   * @param endDate End date for the data
   * @param maxDays Maximum days of data to fetch (365 by default)
   * @returns Combined weather data
   */
  async getDeviceDataForDateRange(
    macAddress: string, 
    startDate: Date, 
    endDate: Date = new Date(),
    maxDays: number = 365
  ): Promise<WeatherData[]> {
    try {
      // Log the date range and fetch constraints
      this.logDateRangeInfo(startDate, endDate, maxDays);
      
      // Fetch data in chunks
      const allData = await this.fetchDataInChunks(macAddress, startDate, endDate);
      
      // Process and return the filtered, sorted data
      return this.processRetrievedData(allData, startDate, endDate);
      
    } catch (error) {
      console.error('Error fetching device data for date range:', error);
      throw error;
    }
  }
  
  /**
   * Logs information about the date range being fetched
   */
  private logDateRangeInfo(startDate: Date, endDate: Date, maxDays: number): void {
    const totalDaysDiff = this.calculateDaysBetweenDates(startDate, endDate);
    const daysToFetch = Math.min(totalDaysDiff, maxDays);
    
    console.log(`Requested date range: ${startDate.toLocaleDateString()} to ${endDate.toLocaleDateString()} (${daysToFetch} days)`);
    console.log(`Starting data fetch sequence...`);
  }
  
  /**
   * Calculates number of days between two dates
   */
  private calculateDaysBetweenDates(startDate: Date, endDate: Date): number {
    return Math.ceil((endDate.getTime() - startDate.getTime()) / AmbientWeatherAPI.MILLISECONDS_PER_DAY);
  }
  
  /**
   * Fetches data in chunks until the start date is reached
   */
  private async fetchDataInChunks(
    macAddress: string, 
    startDate: Date, 
    endDate: Date
  ): Promise<WeatherData[]> {
    let currentEnd = new Date(endDate);
    let allData: WeatherData[] = [];
    let reachedStartDate = false;
    let fetchCount = 0;
    
    // Keep fetching backwards in time until we reach the start date or hit max fetches
    while (!reachedStartDate && fetchCount < AmbientWeatherAPI.MAX_FETCH_OPERATIONS) {
      fetchCount++;
      console.log(`Fetch #${fetchCount}: Requesting data with end date ${currentEnd.toLocaleDateString()}`);
      
      // Get a chunk of data
      const chunkData = await this.getDeviceData(
        macAddress, 
        currentEnd, 
        AmbientWeatherAPI.DEFAULT_READINGS_PER_CHUNK
      );
      
      if (chunkData.length === 0) {
        console.log('Received 0 readings. No more historical data available.');
        break;
      }
      
      console.log(`Retrieved ${chunkData.length} readings for this chunk.`);
      
      // Process this chunk and determine if we should continue
      const { shouldContinue, nextEndDate } = this.processChunk(chunkData, startDate, allData);
      reachedStartDate = !shouldContinue;
      
      if (shouldContinue) {
        // Set the next end date and add a delay before the next request
        currentEnd = nextEndDate;
        await this.delayBeforeNextRequest();
      }
    }
    
    if (fetchCount >= AmbientWeatherAPI.MAX_FETCH_OPERATIONS) {
      console.warn(`Warning: Reached maximum number of fetches (${AmbientWeatherAPI.MAX_FETCH_OPERATIONS}). The data may be incomplete.`);
    }
    
    console.log(`Completed data fetching. Retrieved ${allData.length} total readings.`);
    return allData;
  }
  
  /**
   * Processes a chunk of data and determines if we should continue fetching
   * @returns Object with shouldContinue flag and nextEndDate
   */
  private processChunk(
    chunkData: WeatherData[], 
    startDate: Date, 
    allData: WeatherData[]
  ): { shouldContinue: boolean, nextEndDate: Date } {
    // Find the earliest and latest timestamps in this batch
    const { earliestDate, latestDate, earliestTimestamp } = this.findDateBounds(chunkData);
    
    console.log(`This chunk spans from ${earliestDate.toLocaleDateString()} to ${latestDate.toLocaleDateString()}`);
    
    // Add the data to our collection
    allData.push(...chunkData);
    
    // Check if we've reached or gone past the start date
    if (earliestDate <= startDate) {
      console.log(`Reached or passed the requested start date.`);
      return { 
        shouldContinue: false,
        nextEndDate: new Date() // Not used when shouldContinue is false
      };
    }
    
    // Set the next end date to just before the earliest timestamp from this batch
    const nextEndDate = new Date(earliestTimestamp - AmbientWeatherAPI.ONE_SECOND_MS);
    console.log(`Setting next end date to ${nextEndDate.toLocaleDateString()}`);
    
    return {
      shouldContinue: true,
      nextEndDate
    };
  }
  
  /**
   * Finds the earliest and latest dates in a chunk of data
   */
  private findDateBounds(chunkData: WeatherData[]): { 
    earliestDate: Date, 
    latestDate: Date, 
    earliestTimestamp: number
  } {
    const timestamps = chunkData.map(d => new Date(d.dateutc).getTime());
    const earliestTimestamp = Math.min(...timestamps);
    const latestTimestamp = Math.max(...timestamps);
    
    return {
      earliestDate: new Date(earliestTimestamp),
      latestDate: new Date(latestTimestamp),
      earliestTimestamp
    };
  }
  
  /**
   * Adds a delay before the next API request
   */
  private async delayBeforeNextRequest(): Promise<void> {
    console.log(`Waiting ${this.rateLimitDelay / 1_000} seconds before next request...`);
    await sleep(this.rateLimitDelay);
  }
  
  /**
   * Processes the retrieved data by filtering and sorting
   */
  private processRetrievedData(
    allData: WeatherData[], 
    startDate: Date, 
    endDate: Date
  ): WeatherData[] {
    // Filter to only include data within our desired date range
    const filteredData = this.filterDataByDateRange(allData, startDate, endDate);
    
    console.log(`After filtering to requested date range: ${filteredData.length} readings.`);
    
    // Sort data by timestamp (ascending) to ensure it's in chronological order
    return this.sortDataChronologically(filteredData);
  }
  
  /**
   * Filters data to include only readings within the specified date range
   */
  private filterDataByDateRange(data: WeatherData[], startDate: Date, endDate: Date): WeatherData[] {
    const startTime = startDate.getTime();
    const endTime = endDate.getTime();
    
    return data.filter(entry => {
      const dataTime = new Date(entry.dateutc).getTime();
      return dataTime >= startTime && dataTime <= endTime;
    });
  }
  
  /**
   * Sorts data in chronological order
   */
  private sortDataChronologically(data: WeatherData[]): WeatherData[] {
    return [...data].sort((a, b) => new Date(a.dateutc).getTime() - new Date(b.dateutc).getTime());
  }
}