const Log = require('../../../js/logger.js');
const Database = require('better-sqlite3');

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

const fetchFromLocalCache = (location, modulePath) => {
  // { lat, lon }

  let db;

  try {
    db = new Database(`${modulePath}/geocode/cache.db`, {
      fileMustExist: true
    });
  } catch (error) {
    // if the database doesn't exist, create it and return
    db = new Database(`${modulePath}/geocode/cache.db`, {
      fileMustExist: false
    });
    db.exec(
      'CREATE TABLE locations(lat TEXT NOT NULL, lon TEXT NOT NULL, description TEXT, PRIMARY KEY(lat, lon));'
    );
    return null;
  }

  const query = db.prepare(
    'SELECT description FROM locations WHERE lat = ? AND lon = ?'
  );
  const result = query.get(location.lat, location.lon);

  if (result && result.description) {
    return result.description;
  }
  return null;
};

const appendToLocalCache = (location, description, modulePath) => {
  let db;

  try {
    db = new Database(`${modulePath}/geocode/cache.db`, {
      fileMustExist: true
    });

    const statement = db.prepare(
      'INSERT INTO locations (lat, lon, description) VALUES (?, ?, ?)'
    );
    const info = statement.run(location.lat, location.lon, description);
    Log.info(info);
  } catch (error) {
    // where is the db?
    Log.error(error);
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

const reverseGeocode = async (location, language, modulePath) => {
  const parsedParams = {
    lat: convertDMSToDD(location.latitude.values, location.latitude.reference),
    lon: convertDMSToDD(location.longitude.values, location.longitude.reference)
  };

  const cachedDescription = await fetchFromLocalCache(parsedParams, modulePath);
  if (cachedDescription) {
    Log.info('FETCHED FROM CACHE!');
    return cachedDescription;
  }

  const urlSearchParams = new URLSearchParams();

  urlSearchParams.append('accept-language', language);
  urlSearchParams.append('format', 'geocodejson');

  Object.keys(parsedParams).forEach((key) => {
    if (parsedParams[key]) {
      urlSearchParams.append(key, parsedParams[key]);
    }
  });

  const fetchedData = await fetchFromOpenStreetMap(urlSearchParams);

  if (fetchedData && fetchedData.features && fetchedData.features.length > 0) {
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
      appendToLocalCache(parsedParams, description, modulePath);
      Log.info('FETCHED FROM OSM!');
      return description;
    }
  } else {
    return null;
  }

  // return fetchedData;
};

module.exports = { reverseGeocode };
