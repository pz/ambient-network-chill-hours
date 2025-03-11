#!/usr/bin/env node

import { Command } from 'commander';
import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';
import { AmbientWeatherAPI } from './services/ambientApi';
import { ChillHourCalculator } from './services/chillHours';
import { Config } from './types';

// Load environment variables
dotenv.config();

const program = new Command();

// Default configuration
const defaultConfig: Config = {
  apiKey: process.env.AMBIENT_API_KEY || '',
  applicationKey: process.env.AMBIENT_APPLICATION_KEY,
  defaultStationMac: process.env.AMBIENT_DEFAULT_STATION,
  seasonStart: 9, // September
  chillHourMin: 32,
  chillHourMax: 45,
  rateLimitDelay: process.env.AMBIENT_RATE_LIMIT_DELAY ? parseInt(process.env.AMBIENT_RATE_LIMIT_DELAY) : 1_000 // 1 seconds between requests by default
};

// Load configuration from file if it exists
function loadConfig(configPath: string): Config {
  try {
    if (fs.existsSync(configPath)) {
      const fileConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      return { ...defaultConfig, ...fileConfig };
    }
  } catch (error) {
    console.error('Error loading config file:', error);
  }
  
  return defaultConfig;
}

// Save configuration
function saveConfig(config: Config, configPath: string): void {
  try {
    const dirPath = path.dirname(configPath);
    if (!fs.existsSync(dirPath)) {
      fs.mkdirSync(dirPath, { recursive: true });
    }
    
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
    console.log(`Configuration saved to ${configPath}`);
  } catch (error) {
    console.error('Error saving config file:', error);
  }
}

async function main() {
  const homeDir = process.env.HOME || process.env.USERPROFILE || '';
  const configPath = path.join(homeDir, '.ambient-chill-hours', 'config.json');
  let config = loadConfig(configPath);
  
  program
    .name('ambient-chill-hours')
    .description('Calculate chill hours from Ambient Weather station data')
    .version('1.0.0');
  
  program
    .command('config')
    .description('Configure the application')
    .option('-k, --api-key <key>', 'Ambient Weather API key')
    .option('-a, --app-key <key>', 'Ambient Weather Application key')
    .option('-d, --default-station <mac>', 'Default weather station MAC address')
    .option('-s, --season-start <month>', 'Season start month (1-12)', val => parseInt(val))
    .option('-m, --min-temp <temp>', 'Minimum temperature for chill hour (F)', val => parseInt(val))
    .option('-M, --max-temp <temp>', 'Maximum temperature for chill hour (F)', val => parseInt(val))
    .option('-r, --rate-limit-delay <ms>', 'Delay between API calls in milliseconds (default: 1000)', val => parseInt(val))
    .action((options) => {
      // Update config with provided options
      if (options.apiKey) config.apiKey = options.apiKey;
      if (options.appKey) config.applicationKey = options.appKey;
      if (options.defaultStation) config.defaultStationMac = options.defaultStation;
      if (options.seasonStart) config.seasonStart = options.seasonStart;
      if (options.minTemp) config.chillHourMin = options.minTemp;
      if (options.maxTemp) config.chillHourMax = options.maxTemp;
      if (options.rateLimitDelay) config.rateLimitDelay = options.rateLimitDelay;
      
      saveConfig(config, configPath);
    });
  
  program
    .command('devices')
    .description('List available weather stations')
    .action(async () => {
      if (!config.apiKey) {
        console.error('API key not configured. Run `ambient-chill-hours config --api-key YOUR_KEY`');
        return;
      }
      
      try {
        const api = new AmbientWeatherAPI(
          config.apiKey, 
          config.applicationKey,
          config.rateLimitDelay
        );
        const devices = await api.getDevices();
        
        console.log('Available Weather Stations:');
        devices.forEach((device, index) => {
          const isDefault = device.macAddress === config.defaultStationMac;
          const defaultIndicator = isDefault ? ' [DEFAULT]' : '';
          console.log(`${index + 1}. ${device.info.name} (MAC: ${device.macAddress})${defaultIndicator}`);
        });
        
        if (!config.defaultStationMac) {
          console.log('\nTip: Set a default station with:');
          console.log('  ambient-chill-hours config --default-station YOUR_MAC_ADDRESS');
        }
      } catch (error) {
        console.error('Error fetching devices:', error);
      }
    });
  
  program
    .command('chill')
    .description('Calculate chill hours for a station')
    .option('-m, --mac <address>', 'MAC address of the weather station')
    .option('-d, --days <days>', 'Number of days to fetch (max 30)', val => parseInt(val), 7)
    .option('-y, --year <year>', 'Calculate for specific year', val => parseInt(val))
    .option('-s, --season', 'Calculate for the entire season based on season start month')
    .action(async (options) => {
      if (!config.apiKey) {
        console.error('API key not configured. Run `ambient-chill-hours config --api-key YOUR_KEY`');
        return;
      }
      
      // Use provided MAC or default from config
      const stationMac = options.mac || config.defaultStationMac;
      
      if (!stationMac) {
        console.error('No weather station MAC address provided and no default configured.');
        console.error('Either:');
        console.error('  1. Provide a MAC address with --mac option');
        console.error('  2. Set a default station with `ambient-chill-hours config --default-station YOUR_MAC`');
        console.error('  3. Run `ambient-chill-hours devices` to see available stations');
        return;
      }
      
      try {
        const api = new AmbientWeatherAPI(
          config.apiKey, 
          config.applicationKey, 
          config.rateLimitDelay
        );
        const calculator = new ChillHourCalculator(config.chillHourMin, config.chillHourMax);
        
        // Calculate end date (current time)
        const endDate = new Date();
        
        let data;
        let report;
        
        if (options.season) {
          // For season calculations, we need to fetch much more data
          const currentYear = new Date().getFullYear();
          const year = options.year || currentYear;
          
          // Determine season dates (similar logic to what's in chillHours.ts)
          const seasonStartMonth = config.seasonStart;
          let seasonStart, seasonEnd;
          
          if (seasonStartMonth <= 6) { // Jan-Jun, e.g., Jan 2023 to Dec 2023
            seasonStart = new Date(year, seasonStartMonth - 1, 1);  // e.g., Jan 1, 2023
            seasonEnd = new Date(year, 11, 31);                    // Dec 31, 2023
          } else { // Jul-Dec, e.g., Sep 2022 to Aug 2023
            seasonStart = new Date(year - 1, seasonStartMonth - 1, 1); // e.g., Sep 1, 2022
            seasonEnd = new Date(year, seasonStartMonth - 1, 0);      // Aug 31, 2023 (day before Sep 1)
          }
          
          // Calculate days in the season
          const daysInSeason = Math.ceil((seasonEnd.getTime() - seasonStart.getTime()) / (1000 * 60 * 60 * 24));
          
          // We'll fetch data in chunks since the API might limit how much we can get at once
          // Use the new method to fetch data for the date range in chunks if needed
          console.log(`Fetching data for station: ${stationMac}...`);
          console.log(`Requesting data for season (${seasonStart.toLocaleDateString()} to ${seasonEnd.toLocaleDateString()})`);
          console.log(`This may take a moment as we're fetching seasonal data...`);
          
          data = await api.getDeviceDataForDateRange(stationMac, seasonStart, endDate);
          
          console.log(`Retrieved ${data.length} weather readings`);
          report = calculator.calculateSeasonChillHours(data, config.seasonStart, year);
          console.log(`\nSeason Chill Hours (Starting ${config.seasonStart}/1):`);
        } else {
          // For regular calculations, fetch data for the requested number of days
          console.log(`Fetching data for station: ${stationMac}...`);
          console.log(`Requesting data for the last ${options.days} days...`);
          
          // Calculate start date (current time minus requested days)
          const startDate = new Date();
          startDate.setDate(startDate.getDate() - options.days);
          
          // Use the date range method to ensure we get all requested days
          data = await api.getDeviceDataForDateRange(stationMac, startDate, endDate);
          
          console.log(`Retrieved ${data.length} weather readings`);
          report = calculator.calculateChillHours(data);
          console.log(`\nChill Hours for the last ${options.days} days:`);
        }
        
        console.log(`Period: ${report.date}`);
        console.log(`Temperature Range: ${config.chillHourMin}°F to ${config.chillHourMax}°F`);
        console.log(`Total Hours: ${report.totalHours}`);
        console.log(`Chill Hours: ${report.chillHours} (${report.percentChillHours.toFixed(2)}%)`);
      } catch (error) {
        console.error('Error calculating chill hours:', error);
      }
    });
  
  await program.parseAsync(process.argv);
}

main().catch(error => {
  console.error('An unexpected error occurred:', error);
  process.exit(1);
});