import axios from 'axios';
import {
  getValidator, getCachedData, remember, clearRevalidationCache,
} from './revalidationCache';

// The API origin must come from the environment, not the bundle.
//
// This was hardcoded to http://localhost:5000/api, which works on the dev box and nowhere else:
// a production build points every request at *the viewer's own machine*, so on any other device
// the app loads, spins, and shows empty dashboards — a patient would read that as "no results
// yet" rather than "cannot reach the server". CLAUDE.md has always said the frontend needs an API
// base URL in its .env; the wiring was simply never done.
//
// The localhost fallback keeps `npm run dev` working with no .env at all.
const api = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL || 'http://localhost:5000/api',
  headers: {
    'Content-Type': 'application/json'
  },
  // 304 has to reach the response interceptor rather than being thrown as an error. Axios rejects
  // anything outside 2xx by default, and a Not Modified is the successful outcome here — it is
  // the server saying "what you already have is current".
  validateStatus: (status) => (status >= 200 && status < 300) || status === 304,
});

// Request interceptor to automatically add token to request headers
api.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem('token');
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }

    // Ask the server whether anything changed, instead of asking for the data again. Only for
    // GET: a conditional POST would mean something entirely different. Blob requests are skipped
    // — a report PDF is fetched once and revalidating it would cache the file in memory for the
    // life of the tab, which is the opposite of what this is for.
    if ((config.method || 'get').toLowerCase() === 'get' && config.responseType !== 'blob') {
      const etag = getValidator(config);
      if (etag) config.headers['If-None-Match'] = etag;
    }

    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

// Response interceptor: resolve 304s from memory, remember new validators, handle 401s.
api.interceptors.response.use(
  (response) => {
    const isGet = (response.config?.method || 'get').toLowerCase() === 'get';
    if (!isGet || response.config?.responseType === 'blob') return response;

    if (response.status === 304) {
      const cached = getCachedData(response.config);
      // A 304 with nothing cached should be impossible — we only send If-None-Match when we hold
      // the body — but if the entry was evicted between the two, the honest move is to let the
      // caller see an empty 304 rather than invent data. Callers treat it as "no change".
      return { ...response, data: cached !== undefined ? cached : response.data, fromCache: true };
    }

    remember(response.config, response.headers?.etag, response.data);
    return response;
  },
  (error) => {
    if (error.response && error.response.status === 401) {
      localStorage.removeItem('token');
      // Emptied here as well as on sign-out: these entries hold patient data, and the next
      // account to use this tab must not be able to revalidate into the previous one's queue.
      clearRevalidationCache();
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new Event('auth:unauthorized'));
      }
    }
    return Promise.reject(error);
  }
);

export default api;
