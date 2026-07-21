const ALL_CITIES = '*';

function defaultFilters() {
  return { ageFrom: 18, ageTo: 80, city: '', country: '' };
}

function normalizeFilters(filters) {
  const base = defaultFilters();
  if (!filters || typeof filters !== 'object') {
    return { ...base };
  }

  const ageFrom = Number(filters.ageFrom);
  const ageTo = Number(filters.ageTo);

  return {
    ageFrom: Number.isFinite(ageFrom) ? ageFrom : base.ageFrom,
    ageTo: Number.isFinite(ageTo) ? ageTo : base.ageTo,
    city: filters.city == null ? base.city : String(filters.city).trim(),
    country: filters.country == null ? base.country : String(filters.country).trim(),
  };
}

function isAllCities(filters) {
  return normalizeFilters(filters).city === ALL_CITIES;
}

function matchesCityFilter(user, profile) {
  if (isAllCities(user.filters)) {
    return true;
  }

  const myCity = (user.city || '').trim();
  if (!myCity) {
    return true;
  }

  return (profile.city || '').trim().toLowerCase() === myCity.toLowerCase();
}

function matchesCountryFilter(profile, countryFilter) {
  const filter = (countryFilter || '').trim();
  if (!filter) {
    return true;
  }

  const profileCountry = (profile.country || '').trim().toLowerCase();
  const normalizedFilter = filter.toLowerCase();

  if (normalizedFilter === 'ru') {
    if (!profileCountry) {
      return true;
    }
    return ['ru', 'russia', 'россия'].includes(profileCountry);
  }

  return profileCountry === normalizedFilter;
}

function matchesAgeFilter(profile, filters) {
  const normalized = normalizeFilters(filters);
  const age = Number(profile.age);
  if (!Number.isFinite(age)) {
    return false;
  }
  return age >= normalized.ageFrom && age <= normalized.ageTo;
}

module.exports = {
  ALL_CITIES,
  defaultFilters,
  isAllCities,
  matchesAgeFilter,
  matchesCityFilter,
  matchesCountryFilter,
  normalizeFilters,
};
