'use strict';

const fs = require('fs');
const path = require('path');

/**
 * Простейшее JSON-хранилище настроек/профилей.
 */
class Store {
  constructor(file, defaults = {}) {
    this.file = file;
    this.defaults = defaults;
    this.data = { ...defaults };
    try {
      if (fs.existsSync(file)) {
        const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
        this.data = { ...defaults, ...raw };
      }
    } catch (e) {
      this.data = { ...defaults };
    }
  }

  get(key, fallback) {
    if (Object.prototype.hasOwnProperty.call(this.data, key)) return this.data[key];
    return fallback;
  }

  set(key, value) {
    this.data[key] = value;
    this.save();
    return value;
  }

  setBulk(obj) {
    Object.assign(this.data, obj);
    this.save();
  }

  del(key) {
    delete this.data[key];
    this.save();
  }

  all() {
    return { ...this.data };
  }

  save() {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    fs.writeFileSync(this.file, JSON.stringify(this.data, null, 2), 'utf8');
  }
}

module.exports = Store;
