// Configuration de l'API
// En développement, utilise le proxy Vite (/api/v1)
// En production, utilise l'URL complète du backend Render
export const API_BASE_URL = import.meta.env.MODE === 'production'
  ? import.meta.env.VITE_API_TARGET || 'https://chocolat-backend.onrender.com'
  : '/api/v1';

export const getApiUrl = (path) => {
  const baseUrl = API_BASE_URL.replace(/\/$/, '');
  const cleanPath = path.replace(/^\//, '');
  return `${baseUrl}/${cleanPath}`;
};

// Pour faciliter la transition, on peut aussi exporter une fonction wrapper
export const apiFetch = (path, options = {}) => {
  return fetch(getApiUrl(path), options);
};
