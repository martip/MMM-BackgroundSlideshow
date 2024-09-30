const Log = require('../../../js/logger.js');

const FETCHER_BASE_URL = 'https://nominatim.openstreetmap.org';
const FETCHER_USER_AGENT = 'MMM-BackgroundSlideshow';

const convertDMSToDD = (degrees, minutes, seconds, reference) => {
  let dd = parseFloat(degrees + minutes / 60 + seconds / (60 * 60));
  if (reference === 'S' || reference === 'W') {
    dd *= -1;
  } // Don't do anything for N or E
  return dd;
};

const dataFetcher = async (params) => {
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
    lat: convertDMSToDD(
      ...params.latitude.values,
      params.latitude.reference
    ).toFixed(7),
    lon: convertDMSToDD(
      ...params.longitude.values,
      params.longitude.reference
    ).toFixed(7)
  };

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

  const fetchedData = await dataFetcher(urlSearchParams);

  return fetchedData ? JSON.parse(fetchedData) : null;
};

module.exports = { reverseGeocode };
