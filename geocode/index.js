const Database = require('better-sqlite3');

/*

CREATE TABLE table_name(
   column_1 INTEGER NOT NULL,
   column_2 INTEGER NOT NULL,
   ...
   PRIMARY KEY(column_1,column_2,...)
);

db.run('CREATE TABLE locations(lat REAL NOT NULL, lon REAL NOT NULL, description TEXT, PRIMARY KEY(lat, lon))');

*/

const FETCHER_BASE_URL = 'https://nominatim.openstreetmap.org';
const FETCHER_USER_AGENT = 'MMM-BackgroundSlideshow';

const round = (value) => {
  return Number(Math.round(value + 'e' + 6) + 'e-' + 6);
};

const convertDMSToDD = (degrees, minutes, seconds, reference) => {
  let dd = parseFloat(degrees + minutes / 60 + seconds / (60 * 60));
  if (reference === 'S' || reference === 'W') {
    dd *= -1;
  } // Don't do anything for N or E
  return round(dd);
};

const fetchFromLocalCache = async (params) => {
  // { lat, lon }

  let db;

  try {
    db = new Database(`${this.path}/geocode/cache.db`, { fileMustExist: true });
  } catch (error) {
    // if the database doesn't exist, create it and return
    db = new Database(`${this.path}/geocode/cache.db`, {
      fileMustExist: false
    });
    db.run(
      'CREATE TABLE locations(lat REAL NOT NULL, lon REAL NOT NULL, description TEXT, PRIMARY KEY(lat, lon));'
    );
    return null;
  }

  const query = db.prepare(
    'SELECT description FROM locations WHERE lat = ? AND lon = ?'
  );
  const result = query.get(params.lat, params.lon);

  if (result && result.description) {
    return result.description;
  }
};

const fetchFromOpenStreetMap = async (params) => {
  const requestInfo = `${FETCHER_BASE_URL}/reverse?${params.toString()}`;
  const requestInit = { headers: { 'User-Agent': FETCHER_USER_AGENT } };

  const requestResponse = await fetch(requestInfo, requestInit);

  if (!requestResponse.ok) {
    throw new Error(
      `HTTP error! Status: ${requestResponse.status}. Text: ${requestResponse.statusText}`
    );
  }

  const parsedRequestResponse = await requestResponse.json();

  return parsedRequestResponse;
};

const reverseGeocode = async (params, options) => {
  const urlSearchParams = new URLSearchParams();

  // urlSearchParams.append('accept-language', 'it-IT');
  // urlSearchParams.append('format', 'geocodejson');

  const parsedParams = {
    lat: convertDMSToDD(...params.latitude.values, params.latitude.reference),
    lon: convertDMSToDD(...params.longitude.values, params.longitude.reference)
  };

  const cachedDescription = await fetchFromLocalCache(parsedParams);
  if (cachedDescription) {
    return cachedDescription;
  }

  urlSearchParams.append('format', 'geocodejson');

  Object.keys(parsedParams).forEach((key) => {
    if (parsedParams[key]) {
      urlSearchParams.append(key, parsedParams[key]);
    }
  });

  Object.keys(options).forEach((key) => {
    if (options[key]) {
      urlSearchParams.append(key, options[key]);
    }
  });

  const fetchedData = await fetchFromOpenStreetMap(urlSearchParams);

  if (fetchedData && fetchedData.features && fetchedData.features.length > 0) {
    // Log.info(JSON.stringify(fetchedData.features, null, 2));
    if (
      fetchedData.features[0].properties &&
      fetchedData.features[0].properties.geocoding
    ) {
      const geocoding = fetchedData.features[0].properties.geocoding;
      const descriptionChunks = [];
      let description = '';
      if (geocoding.name) {
        descriptionChunks.push(geocoding.name);
      } else if (geocoding.street) {
        descriptionChunks.push(geocoding.street);
      }
      if (geocoding.city) {
        descriptionChunks.push(geocoding.city);
      }
      description = descriptionChunks.join(' - ');
      return description;
    }
  } else {
    return null;
  }

  // return fetchedData;
};

module.exports = { reverseGeocode };
