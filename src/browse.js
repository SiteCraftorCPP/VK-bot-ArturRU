const {
  matchesAgeFilter,
  matchesCityFilter,
  matchesCountryFilter,
  normalizeFilters,
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

function findNextProfile(user, profiles, likes, isBoosted) {
  const normalizedUser = { ...user, filters: normalizeFilters(user.filters) };

  const freshPass = listBrowseCandidates(
    normalizedUser,
    profiles,
    likes,
    isBoosted,
    getBrowseExcludedIds(user.id, likes, ['pending', 'rejected', 'matched']),
  );
  if (freshPass[0]) {
    return freshPass[0];
  }

  const loopPass = listBrowseCandidates(
    normalizedUser,
    profiles,
    likes,
    isBoosted,
    getBrowseExcludedIds(user.id, likes, ['matched']),
  );
  return loopPass[0] || null;
}

module.exports = {
  compareBoostedProfiles,
  findNextProfile,
  rankProfilesForBrowse,
};
