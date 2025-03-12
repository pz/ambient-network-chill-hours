# Ambient Weather Chill Hours Calculator

A command line tool to fetch data from Ambient Weather stations and calculate chill hours for agricultural purposes.

[![npm version](https://badge.fury.io/js/%40yourusername%2Fambient-chill-hours.svg)](https://badge.fury.io/js/%40yourusername%2Fambient-chill-hours)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

## Installation

### From npm

```bash
# Install globally
npm install -g @yourusername/ambient-chill-hours

# Or locally in a project
npm install @yourusername/ambient-chill-hours
```

### From source

```bash
# Clone the repository
git clone https://github.com/yourusername/ambient-chill-hours.git
cd ambient-chill-hours

# Install dependencies
npm install

# Build the project
npm run build

# Link the package globally (optional)
npm link
```

## Configuration

You'll need an Ambient Weather API key to use this tool. You can get one by signing up at [https://ambientweather.net/](https://ambientweather.net/).

Configure the tool with your API key:

```bash
ambient-chill-hours config --api-key YOUR_API_KEY
```

Additional configuration options:

- `--app-key`: Your Ambient Weather application key (optional)
- `--default-station`: Default weather station MAC address (so you don't need to specify it each time)
- `--season-start`: Month to start the chill hour season (1-12, default: 9 for September)
- `--min-temp`: Minimum temperature for chill hour calculation in °F (default: 32)
- `--max-temp`: Maximum temperature for chill hour calculation in °F (default: 45)
- `--rate-limit-delay`: Delay between API calls in milliseconds (default: 1000)

### Rate Limiting

The Ambient Weather API has rate limits on how many requests you can make in a given time period. If you encounter "rate limit exceeded" errors when fetching data for a full season, you can adjust the delay between API calls by using the `--rate-limit-delay` option:

```bash
# Increase delay to 5 seconds between API calls
ambient-chill-hours config --rate-limit-delay 5000
```

You can also set this in your .env file with `AMBIENT_RATE_LIMIT_DELAY=5000`.

## Usage

### List Available Weather Stations

```bash
ambient-chill-hours devices
```

### Calculate Chill Hours

For the last 7 days:

```bash
# If you've set a default station
ambient-chill-hours chill

# Or specify a station
ambient-chill-hours chill --mac YOUR_STATION_MAC_ADDRESS
```

For a specific number of days:

```bash
ambient-chill-hours chill --days 14
```

For the entire season (based on configured season start):

```bash
ambient-chill-hours chill --season
```

For a specific year's season:

```bash
ambient-chill-hours chill --season --year 2023
```

## What are Chill Hours?

Chill hours are a measurement used in agriculture, particularly for fruit trees and some other perennial plants. They represent the number of hours during the dormant season when temperatures are within a specific range (typically between 32°F and 45°F). Many fruit trees require a certain number of chill hours to produce properly in the following growing season.

## License

MIT