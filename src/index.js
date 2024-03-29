const { URL } = require('url');
const qs = require('querystring');

const monk = require('monk');
const mapKeys = require('lodash/mapKeys');

const NAMESPACE = 'axios-logger-mongo';

const logRequest = () => axiosConfig => {
  axiosConfig[NAMESPACE] = Object.assign(
    { requestTimestamp: Date.now() },
    axiosConfig[NAMESPACE]
  );
  return axiosConfig;
};

function createRequestObject({
  axiosConfig,
  axiosRequest,
  transformRequestBody,
}) {
  const url = new URL(axiosConfig.url);

  const requestHeaders = {
    host: url.host,
    ...mapKeys(axiosConfig.headers, (val, key) => key.toLowerCase()),
  };

  let requestBody;

  if (
    requestHeaders['content-type'] &&
    requestHeaders['content-type'].startsWith('application/json')
  ) {
    try {
      requestBody = JSON.parse(axiosConfig.data);
    } catch (err) {
      requestBody = requestBody || null;
    }
  } else {
    requestBody = axiosConfig.data || null;
  }

  if (requestBody && typeof transformRequestBody === 'function') {
    requestBody = transformRequestBody(requestBody, {
      request: axiosRequest,
      config: axiosConfig,
    });
  }

  return {
    method: axiosRequest.method || axiosConfig.method.toUpperCase(),
    path: axiosRequest.path || url.pathname,
    headers: requestHeaders,
    query: {
      ...qs.parse(url.search.replace('?', '')),
      ...axiosConfig.params,
    },
    body: requestBody,
  };
}

function createResponseObject({ axiosResponse, transformResponseBody }) {
  let body = axiosResponse.data || null;
  if (body && typeof transformResponseBody === 'function') {
    body = transformResponseBody(body, {
      response: axiosResponse,
      config: axiosResponse.config,
    });
  }
  return {
    status: axiosResponse.status,
    statusText: axiosResponse.statusText,
    headers: axiosResponse.headers,
    body,
  };
}

const logResponse = (
  collection,
  { transformRequestBody, transformResponseBody } = {}
) => axiosResponse => {
  const axiosConfig = axiosResponse.config;
  const axiosRequest = axiosResponse.request;

  const { requestTimestamp } = axiosConfig[NAMESPACE];
  const responseTimestamp = Date.now();

  const request = createRequestObject({
    axiosConfig,
    axiosRequest,
    transformRequestBody,
  });
  const response = createResponseObject({
    axiosResponse,
    transformResponseBody,
  });

  collection.insert({
    request,
    response,
    error: null,
    time: responseTimestamp - requestTimestamp,
  });

  return axiosResponse;
};

const logError = (collection, { transformRequestBody } = {}) => axiosError => {
  const axiosConfig = axiosError.config;
  const axiosRequest = axiosError.request;

  const { requestTimestamp } = axiosConfig[NAMESPACE];
  const errorTimestamp = Date.now();

  const request = createRequestObject({
    axiosConfig,
    axiosRequest,
    transformRequestBody,
  });

  const response = null;

  const error = axiosError.message;

  collection.insert({
    request,
    response,
    error,
    time: errorTimestamp - requestTimestamp,
  });

  return Promise.reject(axiosError);
};

function useMongoLogger(
  axios,
  {
    mongoURL,
    collectionName,
    allInstances = false,
    transformRequestBody,
    transformResponseBody,
  }
) {
  const db = monk(mongoURL);

  const collection = db.get(collectionName);

  axios.interceptors.request.use(logRequest(collection));
  axios.interceptors.response.use(
    logResponse(collection, { transformRequestBody, transformResponseBody }),
    logError(collection, { transformRequestBody })
  );

  if (allInstances && axios.create) {
    const axiosCreate = axios.create.bind(axios);

    axios.create = (...args) => {
      const instance = axiosCreate(...args);

      useMongoLogger(instance, {
        mongoURL,
        collectionName,
        transformRequestBody,
        transformResponseBody,
      });

      return instance;
    };
  }
}

module.exports = {
  useMongoLogger,
};
