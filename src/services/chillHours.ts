import { WeatherData, ChillHourReport } from '../types';

export class ChillHourCalculator {
  // Constants
  private static readonly DEFAULT_MIN_TEMP_F = 32;
  private static readonly DEFAULT_MAX_TEMP_F = 45;
  private static readonly READINGS_PER_HOUR = 12; // Ambient Weather typically provides data at 5-minute intervals
  private static readonly MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1_000;
  private static readonly HOUR_KEY_FORMAT = 'YYYY-MM-DD-HH';
  private static readonly MIN_COVERAGE_PERCENT = 80;
  private static readonly DECEMBER_MONTH = 11; // 0-based month index
  
  private minTemp: number;
  private maxTemp: number;
  
  constructor(
    minTemp: number = ChillHourCalculator.DEFAULT_MIN_TEMP_F, 
    maxTemp: number = ChillHourCalculator.DEFAULT_MAX_TEMP_F
  ) {
    this.minTemp = minTemp;
    this.maxTemp = maxTemp;
  }
  
  /**
   * Calculates chill hours from weather data
   * @param data Array of weather data points
   * @returns Chill hour report
   */
  calculateChillHours(data: WeatherData[]): ChillHourReport {
    // Sort data by date to ensure chronological order
    const sortedData = this.sortDataChronologically(data);
    
    if (sortedData.length === 0) {
      return this.createEmptyReport("No data available");
    }
    
    // Group readings by hour
    const hourlyData = this.groupReadingsByHour(sortedData);
    
    // Calculate chill hours
    const { totalHours, chillHours } = this.countChillHours(hourlyData);
    
    // Create report
    return this.createReport(sortedData, totalHours, chillHours);
  }
  
  /**
   * Creates an empty report when no data is available
   */
  private createEmptyReport(message: string): ChillHourReport {
    return {
      totalHours: 0,
      chillHours: 0,
      date: message,
      percentChillHours: 0
    };
  }
  
  /**
   * Sorts weather data chronologically
   */
  private sortDataChronologically(data: WeatherData[]): WeatherData[] {
    return [...data].sort((a, b) => a.dateutc - b.dateutc);
  }
  
  /**
   * Groups readings by hour
   */
  private groupReadingsByHour(
    sortedData: WeatherData[]
  ): Map<string, { temps: number[], inRange: number }> {
    const hourlyData = new Map<string, { temps: number[], inRange: number }>();
    
    for (const entry of sortedData) {
      const hourKey = this.createHourKey(entry.dateutc);
      
      if (!hourlyData.has(hourKey)) {
        hourlyData.set(hourKey, { temps: [], inRange: 0 });
      }
      
      const hourData = hourlyData.get(hourKey)!;
      hourData.temps.push(entry.tempf);
      
      // Count if this reading is in the chill hour range
      if (this.isTemperatureInChillRange(entry.tempf)) {
        hourData.inRange++;
      }
    }
    
    return hourlyData;
  }
  
  /**
   * Creates a key for grouping readings by hour
   */
  private createHourKey(timestamp: number): string {
    const date = new Date(timestamp);
    return `${date.getFullYear()}-${date.getMonth()+1}-${date.getDate()}-${date.getHours()}`;
  }
  
  /**
   * Checks if a temperature is within the chill hour range
   */
  private isTemperatureInChillRange(tempF: number): boolean {
    return tempF >= this.minTemp && tempF <= this.maxTemp;
  }
  
  /**
   * Counts total hours and chill hours from hourly data
   */
  private countChillHours(
    hourlyData: Map<string, { temps: number[], inRange: number }>
  ): { totalHours: number, chillHours: number } {
    let chillHours = 0;
    const totalHours = hourlyData.size; // Each entry in the map is one hour
    
    // An hour counts as a chill hour if the majority of readings in that hour are in range
    for (const [_, hourData] of hourlyData.entries()) {
      if (this.isChillHour(hourData)) {
        chillHours++;
      }
    }
    
    return { totalHours, chillHours };
  }
  
  /**
   * Determines if an hour counts as a chill hour
   */
  private isChillHour(hourData: { temps: number[], inRange: number }): boolean {
    // If at least half the readings in an hour are in range, count it as a chill hour
    return hourData.temps.length > 0 && hourData.inRange / hourData.temps.length >= 0.5;
  }
  
  /**
   * Creates a report from the calculated data
   */
  private createReport(
    sortedData: WeatherData[], 
    totalHours: number, 
    chillHours: number
  ): ChillHourReport {
    const startDate = new Date(sortedData[0].dateutc);
    const endDate = new Date(sortedData[sortedData.length - 1].dateutc);
    const dateStr = `${startDate.toLocaleDateString()} to ${endDate.toLocaleDateString()}`;
    
    return {
      totalHours,
      chillHours,
      date: dateStr,
      percentChillHours: totalHours > 0 ? (chillHours / totalHours) * 100 : 0
    };
  }
  
  /**
   * Calculates chill hours from a start date (season beginning)
   * @param allData All weather data
   * @param seasonStartMonth Month to start calculating from (1-12)
   * @param year Year to calculate for (if undefined, uses current year)
   * @returns Chill hour report
   */
  calculateSeasonChillHours(allData: WeatherData[], seasonStartMonth: number, year?: number): ChillHourReport {
    // Determine season date range
    const { seasonStart, seasonEnd } = this.determineSeasonDates(seasonStartMonth, year);
    
    // Log season information
    this.logSeasonInfo(seasonStart, seasonEnd);
    
    // Filter data within the season
    const seasonData = this.filterDataForSeason(allData, seasonStart, seasonEnd);
    
    // Check if we have data and log coverage
    if (seasonData.length === 0) {
      console.warn(`Warning: No data found within the season. Check your station has historical data for this period.`);
      return this.createEmptyReport(`${seasonStart.toLocaleDateString()} to ${seasonEnd.toLocaleDateString()} (no data)`);
    }
    
    this.logDataCoverage(seasonData, seasonStart, seasonEnd);
    
    // Calculate and return report
    const report = this.calculateChillHours(seasonData);
    
    // Log calculation method
    this.logCalculationMethod();
    
    return report;
  }
  
  /**
   * Determines the start and end dates for a season
   */
  private determineSeasonDates(
    seasonStartMonth: number, 
    year?: number
  ): { seasonStart: Date, seasonEnd: Date } {
    const currentYear = new Date().getFullYear();
    const calculationYear = year || currentYear;
    
    let seasonStart: Date;
    let seasonEnd: Date;
    
    if (seasonStartMonth <= 6) { 
      // Jan-Jun, e.g., Jan 2023 to Dec 2023
      seasonStart = new Date(calculationYear, seasonStartMonth - 1, 1);
      seasonEnd = new Date(calculationYear, ChillHourCalculator.DECEMBER_MONTH, 31);
    } else { 
      // Jul-Dec, e.g., Sep 2022 to Aug 2023
      seasonStart = new Date(calculationYear - 1, seasonStartMonth - 1, 1);
      seasonEnd = new Date(calculationYear, seasonStartMonth - 1, 0); // Last day of month before season start month
    }
    
    return { seasonStart, seasonEnd };
  }
  
  /**
   * Logs information about the season date range
   */
  private logSeasonInfo(seasonStart: Date, seasonEnd: Date): void {
    const totalSeasonDays = this.calculateDaysBetween(seasonStart, seasonEnd);
    
    console.log(`\nFiltering data for season: ${seasonStart.toLocaleDateString()} to ${seasonEnd.toLocaleDateString()}`);
    console.log(`Total season duration: ${totalSeasonDays} days`);
  }
  
  /**
   * Calculates days between two dates
   */
  private calculateDaysBetween(startDate: Date, endDate: Date): number {
    return Math.round((endDate.getTime() - startDate.getTime()) / ChillHourCalculator.MILLISECONDS_PER_DAY);
  }
  
  /**
   * Filters data to only include readings within the season
   */
  private filterDataForSeason(
    allData: WeatherData[], 
    seasonStart: Date, 
    seasonEnd: Date
  ): WeatherData[] {
    const seasonData = allData.filter(entry => {
      const entryDate = new Date(entry.dateutc);
      return entryDate >= seasonStart && entryDate <= seasonEnd;
    });
    
    console.log(`Found ${seasonData.length} readings within the season date range`);
    return seasonData;
  }
  
  /**
   * Logs information about the data coverage for the season
   */
  private logDataCoverage(
    seasonData: WeatherData[], 
    seasonStart: Date, 
    seasonEnd: Date
  ): void {
    const { earliestDate, latestDate } = this.findDateRange(seasonData);
    
    const coverageDays = this.calculateDaysBetween(earliestDate, latestDate);
    const totalSeasonDays = this.calculateDaysBetween(seasonStart, seasonEnd);
    const coveragePercent = Math.round((coverageDays / totalSeasonDays) * 100);
    
    console.log(`Available data spans: ${earliestDate.toLocaleDateString()} to ${latestDate.toLocaleDateString()}`);
    console.log(`Data coverage: ${coverageDays} out of ${totalSeasonDays} days (${coveragePercent}%)`);
    
    // Warn if coverage is low
    if (coveragePercent < ChillHourCalculator.MIN_COVERAGE_PERCENT) {
      console.warn(`Warning: Data coverage is only ${coveragePercent}% of the season. Results may be incomplete.`);
    }
  }
  
  /**
   * Finds the earliest and latest dates in a data set
   */
  private findDateRange(data: WeatherData[]): { earliestDate: Date, latestDate: Date } {
    const timestamps = data.map(d => new Date(d.dateutc).getTime());
    return {
      earliestDate: new Date(Math.min(...timestamps)),
      latestDate: new Date(Math.max(...timestamps))
    };
  }
  
  /**
   * Logs information about the calculation method
   */
  private logCalculationMethod(): void {
    console.log(
      `\nCalculation method: An hour is counted as a "chill hour" if the majority of readings ` +
      `during that hour were between ${this.minTemp}°F and ${this.maxTemp}°F`
    );
  }
}