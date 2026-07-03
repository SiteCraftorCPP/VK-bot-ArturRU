const fs = require('node:fs');
const path = require('node:path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const DB_PATH = path.join(DATA_DIR, 'db.json');

const defaultData = {
  users: {},
  likes: [],
  settings: {
    channelUrl: 'https://vk.com/nikaxbot',
    moderatorUrl: 'https://vk.com/rustambek_u',
  },
};

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

class Store {
  constructor(filePath = DB_PATH) {
    this.filePath = filePath;
    this.data = clone(defaultData);
    this.load();
  }

  load() {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });

    if (!fs.existsSync(this.filePath)) {
      this.save();
      return;
    }

    const raw = fs.readFileSync(this.filePath, 'utf8').trim();
    if (!raw) {
      this.save();
      return;
    }

    const parsed = JSON.parse(raw);
    this.data = {
      ...clone(defaultData),
      ...parsed,
      settings: {
        ...clone(defaultData.settings),
        ...(parsed.settings || {}),
      },
    };

    if (!this.data.settings.channelUrl) {
      this.data.settings.channelUrl = defaultData.settings.channelUrl;
    }
    if (!this.data.settings.moderatorUrl) {
      this.data.settings.moderatorUrl = defaultData.settings.moderatorUrl;
    }
  }

  save() {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    fs.writeFileSync(this.filePath, JSON.stringify(this.data, null, 2), 'utf8');
  }

  getUser(id) {
    return this.data.users[String(id)] || null;
  }

  ensureUser(id) {
    const key = String(id);
    if (!this.data.users[key]) {
      this.data.users[key] = {
        id: key,
        isMock: false,
        gender: null,
        age: null,
        city: '',
        country: '',
        name: '',
        about: '',
        photo: '',
        photoUrl: '',
        active: true,
        blocked: false,
        profileComplete: false,
        state: 'new',
        draft: {},
        filters: {
          ageFrom: 18,
          ageTo: 80,
          city: '',
          country: '',
        },
        pendingLikeTarget: null,
        subscribedUntil: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      this.save();
    }

    return this.data.users[key];
  }

  updateUser(id, patch) {
    const user = this.ensureUser(id);
    Object.assign(user, patch, { updatedAt: new Date().toISOString() });
    this.save();
    return user;
  }

  updateDraft(id, patch) {
    const user = this.ensureUser(id);
    user.draft = {
      ...(user.draft || {}),
      ...patch,
    };
    user.updatedAt = new Date().toISOString();
    this.save();
    return user;
  }

  completeProfile(id) {
    const user = this.ensureUser(id);
    Object.assign(user, user.draft, {
      draft: {},
      state: 'ready',
      active: true,
      profileComplete: true,
      updatedAt: new Date().toISOString(),
    });
    this.save();
    return user;
  }

  createMockProfile(profile) {
    const id = `mock_${Date.now()}_${Math.random().toString(16).slice(2)}`;
    this.data.users[id] = {
      id,
      isMock: true,
      gender: profile.gender,
      age: profile.age,
      city: profile.city,
      country: profile.country || '',
      name: profile.name,
      about: profile.about,
      photo: profile.photo || '',
      photoUrl: profile.photoUrl || '',
      active: true,
      blocked: false,
      profileComplete: true,
      state: 'ready',
      draft: {},
      filters: {
        ageFrom: 18,
        ageTo: 80,
        city: '',
        country: '',
      },
      pendingLikeTarget: null,
      subscribedUntil: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    this.save();
    return this.data.users[id];
  }

  listProfiles() {
    return Object.values(this.data.users);
  }

  listRealUsers(gender) {
    return this.listProfiles()
      .filter((user) => !user.isMock && user.gender === gender && user.profileComplete)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }

  listAdminPanelUsers(gender) {
    return this.listProfiles()
      .filter((user) => user.gender === gender && user.profileComplete)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }

  searchAdminPanelUsers(query, limit = 100) {
    const value = String(query || '').trim().toLowerCase();
    if (!value) {
      return [];
    }

    const ageQuery = /^\d{1,2}$/.test(value) ? Number(value) : null;

    return this.listProfiles()
      .filter((user) => user.profileComplete)
      .filter((user) => {
        if (String(user.id).includes(value)) {
          return true;
        }
        if (String(user.name || '').toLowerCase().includes(value)) {
          return true;
        }
        if (String(user.city || '').toLowerCase().includes(value)) {
          return true;
        }
        if (ageQuery !== null && user.age === ageQuery) {
          return true;
        }
        return false;
      })
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .slice(0, limit);
  }

  blockUser(id) {
    return this.updateUser(id, { blocked: true, active: false, state: 'ready' });
  }

  unblockUser(id) {
    return this.updateUser(id, { blocked: false, active: true, state: 'ready' });
  }

  deleteUser(id) {
    const key = String(id);
    delete this.data.users[key];
    this.data.likes = this.data.likes.filter(
      (like) => like.fromId !== key && like.toId !== key,
    );
    this.save();
  }

  isSubscribed(user) {
    if (!user || !user.subscribedUntil) {
      return false;
    }

    return new Date(user.subscribedUntil).getTime() > Date.now();
  }

  addLike(fromId, toId, status = 'pending') {
    const existing = this.data.likes.find(
      (like) => like.fromId === String(fromId) && like.toId === String(toId),
    );

    if (existing) {
      existing.status = status;
      existing.updatedAt = new Date().toISOString();
      this.save();
      return existing;
    }

    const like = {
      fromId: String(fromId),
      toId: String(toId),
      status,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    this.data.likes.push(like);
    this.save();
    return like;
  }

  rejectProfile(fromId, toId) {
    return this.addLike(fromId, toId, 'rejected');
  }

  getLike(fromId, toId) {
    return this.data.likes.find(
      (like) => like.fromId === String(fromId) && like.toId === String(toId),
    );
  }

  getIncomingLikes(userId) {
    return this.data.likes.filter(
      (like) => like.toId === String(userId) && like.status === 'pending',
    );
  }

  getStats() {
    const users = this.listProfiles();
    return {
      total: users.length,
      real: users.filter((user) => !user.isMock).length,
      mock: users.filter((user) => user.isMock).length,
      men: users.filter((user) => user.gender === 'male').length,
      women: users.filter((user) => user.gender === 'female').length,
      active: users.filter((user) => user.active && user.profileComplete).length,
      paid: users.filter((user) => this.isSubscribed(user)).length,
      likes: this.data.likes.length,
    };
  }

  updateSettings(patch) {
    this.data.settings = {
      ...this.data.settings,
      ...patch,
    };
    this.save();
    return this.data.settings;
  }
}

module.exports = {
  Store,
};
