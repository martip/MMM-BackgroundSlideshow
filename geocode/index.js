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

const getMinorPlace = (address) => {
  if (address.neighbourhood || address.hamlet) {
    return address.neighbourhood || address.hamlet;
  }
  let streetAddress = address.road ? address.road : '';
  streetAddress += address.house_number ? ` ${address.house_number}` : '';
  if (streetAddress !== '') {
    return streetAddress;
  }
  return null;
};
const getMajorPlace = (address) =>
  address.city || address.town || address.village || null;

const getPlaceForNamedLocation = (address) =>
  address.city ||
  address.town ||
  address.village ||
  address.hamlet ||
  address.neighbourhood ||
  null;

const fetchFromLocalCache = (data, modulePath) => {
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
      'CREATE TABLE locations(latMin REAL NOT NULL, latMax REAL NOT NULL, lonMin REAL NOT NULL, lonMax REAL NOT NULL, description TEXT, PRIMARY KEY(latMin, latMax, lonMin, lonMax));'
    );
    db.exec(
      'CREATE TABLE images(hash TEXT, description TEXT, PRIMARY KEY(hash));'
    );
    return null;
  }

  const hashQuery = db.prepare(
    'SELECT description FROM images WHERE hash = ?;'
  );
  const hashResult = hashQuery.get(data.hash);
  if (hashResult && hashResult.description) {
    return hashResult.description;
  }

  const query = db.prepare(
    'SELECT description FROM locations WHERE (? BETWEEN latMin AND latMax) AND (? BETWEEN lonMin AND lonMax);'
  );
  const result = query.get(data.lat, data.lon);

  if (result && result.description) {
    const hashInsert = db.prepare(
      'INSERT INTO images(hash, description) VALUES(?, ?);'
    );
    hashInsert.run(data.hash, result.description);
    return result.description;
  }
  return null;
};

const appendToLocalCache = (boundingBox, description, hash, modulePath) => {
  if (!boundingBox || boundingBox.length < 4 || !description) {
    return;
  }
  let db;

  try {
    db = new Database(`${modulePath}/geocode/cache.db`, {
      fileMustExist: true
    });

    const statement = db.prepare(
      'INSERT INTO locations (latMin, latMax, lonMin, lonMax, description) VALUES (?, ?, ?, ?, ?)'
    );
    statement.run(
      boundingBox[1],
      boundingBox[3],
      boundingBox[0],
      boundingBox[2],
      description
    );

    const hashInsert = db.prepare(
      'INSERT INTO images(hash, description) VALUES(?, ?);'
    );
    hashInsert.run(hash, description);
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

const reverseGeocode = async (data, language, modulePath) => {
  const parsedParams = {
    lat: convertDMSToDD(...data.latitude.values, data.latitude.reference),
    lon: convertDMSToDD(...data.longitude.values, data.longitude.reference),
    hash: data.hash
  };

  const cachedDescription = await fetchFromLocalCache(parsedParams, modulePath);
  if (cachedDescription) {
    Log.info(
      'BACKGROUNDSLIDESHOW: fetched reverse geocode info from local cache'
    );
    return cachedDescription;
  }

  const urlSearchParams = new URLSearchParams();

  urlSearchParams.append('accept-language', language);
  urlSearchParams.append('format', 'geojson');
  urlSearchParams.append('zoom', '15');

  Object.keys(parsedParams).forEach((key) => {
    if (parsedParams[key]) {
      urlSearchParams.append(key, parsedParams[key]);
    }
  });

  const fetchedData = await fetchFromOpenStreetMap(urlSearchParams);

  if (fetchedData && fetchedData.features && fetchedData.features.length > 0) {
    // const descriptionTokens = [];
    // let description = null;

    const [feature] = fetchedData.features;
    const { properties, bbox } = feature;
    const { address } = properties;

    const description = getMajorPlace(address);

    // if (properties.name) {
    //   descriptionTokens.push(properties.name);
    //   const place = getPlaceForNamedLocation(address);
    //   if (place) {
    //     descriptionTokens.push(place);
    //   }
    // } else {
    //   const majorPlace = getMajorPlace(address);
    //   const streetAddress = getMinorPlace(address);

    //   if (majorPlace) {
    //     if (streetAddress) {
    //       descriptionTokens.push(streetAddress);
    //     }
    //     descriptionTokens.push(majorPlace);
    //   }
    // }
    // description = descriptionTokens.join(' - ');

    appendToLocalCache(bbox, description, data.hash, modulePath);
    Log.info(
      'BACKGROUNDSLIDESHOW: fetched reverse geocode info from OpenStreetMap'
    );
    return description;
  }
  return null;
};

module.exports = { reverseGeocode };
