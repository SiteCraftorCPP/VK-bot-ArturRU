const {
  ALL_CITIES,
  BROWSE_RELAXED_AGE,
  isAllCities,
  matchesAgeFilter,
  matchesCityFilter,
  matchesCountryFilter,
  normalizeFilters,
  defaultFilters,
} = require('./filters');

function compareBoostedProfiles(a, b) {
  const aBoostedAt = new Date(a.boostedAt || 0).getTime();
  const bBoostedAt = new Date(b.boostedAt || 0).getTime();
  if (aBoostedAt !== bBoostedAt) {
    return bBoostedAt - aBoostedAt;
  }
  return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
}

function compareRegularProfiles(a, b) {
  return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
}

function rankProfilesForBrowse(profiles, isBoosted) {
  return [...profiles].sort((a, b) => {
    const aBoost = isBoosted(a);
    const bBoost = isBoosted(b);

    if (aBoost !== bBoost) {
      return aBoost ? -1 : 1;
    }

    if (aBoost && bBoost) {
      return compareBoostedProfiles(a, b);
    }

    return compareRegularProfiles(a, b);
  });
}

function getBrowseExcludedIds(userId, likes, statuses) {
  return new Set(
    likes
      .filter((like) => like.fromId === String(userId))
      .filter((like) => statuses.includes(like.status))
      .map((like) => like.toId),
  );
}

function withBrowseFilters(user, filtersPatch = {}) {
  return {
    ...user,
    filters: normalizeFilters({
      ...normalizeFilters(user.filters),
      ...filtersPatch,
    }),
  };
}

function listBrowseCandidates(user, profiles, likes, isBoosted, excludedIds) {
  const wantedGender = user.gender === 'male' ? 'female' : 'male';
  const filters = normalizeFilters(user.filters);
  const browseUser = { ...user, filters };

  const matched = profiles
    .filter((profile) => profile.id !== String(user.id))
    .filter((profile) => profile.profileComplete && profile.active)
    .filter((profile) => profile.gender === wantedGender)
    .filter((profile) => !excludedIds.has(profile.id))
    .filter((profile) => matchesCityFilter(browseUser, profile))
    .filter((profile) => matchesCountryFilter(profile, filters.country))
    .filter((profile) => matchesAgeFilter(profile, filters));

  return rankProfilesForBrowse(matched, isBoosted);
}

function pickFromPasses(user, profiles, likes, isBoosted, passes) {
  for (const pass of passes) {
    const excludedIds = getBrowseExcludedIds(user.id, likes, pass.excludeStatuses);
    const browseUser = pass.filtersPatch ? withBrowseFilters(user, pass.filtersPatch) : withBrowseFilters(user);
    const candidates = listBrowseCandidates(
      browseUser,
      profiles,
      likes,
      isBoosted,
      excludedIds,
    );
    if (candidates[0]) {
      return candidates[0];
    }
  }
  return null;
}

const BROWSE_SKIP_STATUSES = ['pending', 'rejected', 'matched'];

function findNextProfile(user, profiles, likes, isBoosted) {
  const normalizedUser = withBrowseFilters(user);

  return pickFromPasses(normalizedUser, profiles, likes, isBoosted, [
    { excludeStatuses: BROWSE_SKIP_STATUSES },
    { excludeStatuses: BROWSE_SKIP_STATUSES, filtersPatch: BROWSE_RELAXED_AGE },
    { excludeStatuses: BROWSE_SKIP_STATUSES, filtersPatch: { ...BROWSE_RELAXED_AGE, city: ALL_CITIES } },
  ]);
}

function getOppositeGenderProfiles(user, profiles) {
  const wantedGender = user.gender === 'male' ? 'female' : 'male';
  return profiles.filter(
    (profile) => profile.id !== String(user.id)
      && profile.profileComplete
      && profile.active
      && profile.gender === wantedGender,
  );
}

function getBrowseEmptyMessage(user, profiles) {
  const filters = normalizeFilters(user.filters);
  const pool = getOppositeGenderProfiles(user, profiles);

  if (!pool.length) {
    return 'Пока нет анкет для знакомств 🌙 Когда появятся новые — бот покажет их здесь.';
  }

  const lines = ['Сейчас нет анкет по вашим фильтрам 🌙'];

  if (!isAllCities(filters)) {
    lines.push(`Город: ${user.city || 'ваш город'}. Попробуйте «Все города» в фильтрах.`);
  }

  const defaults = defaultFilters();
  if (filters.ageFrom !== defaults.ageFrom || filters.ageTo !== defaults.ageTo) {
    lines.push(`Возраст: ${filters.ageFrom}-${filters.ageTo}. Расширьте диапазон в «Фильтр поиска 🔎».`);
  }

  if (filters.country) {
    lines.push(`Страна: ${filters.country}. Попробуйте «Все страны» в фильтрах.`);
  }

  lines.push('Или нажмите «Смотреть анкеты 💞» позже — лента обновляется.');
  return lines.join('\n');
}

module.exports = {
  compareBoostedProfiles,
  findNextProfile,
  getBrowseEmptyMessage,
  rankProfilesForBrowse,
};
