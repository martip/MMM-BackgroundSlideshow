/*
 * node_helper.js
 *
 * MagicMirror²
 * Module: MMM-BackgroundSlideshow
 *
 * MagicMirror² By Michael Teeuw https://michaelteeuw.nl
 * MIT Licensed.
 *
 * Module MMM-BackgroundSlideshow By Darick Carpenter
 * MIT Licensed.
 */

// call in the required classes
const NodeHelper = require('node_helper');
const FileSystemImageSlideshow = require('fs');
const { exec } = require('child_process');
const express = require('express');
const Log = require('../../js/logger.js');
const basePath = '/images/';
const sharp = require('sharp');
const path = require('path');
const reverseGeocode = require('./geocode').reverseGeocode;

// the main module helper create
module.exports = NodeHelper.create({
  // subclass start method, clears the initial config array
  start() {
    this.excludePaths = new Set();
    this.validImageFileExtensions = new Set();
    this.expressInstance = this.expressApp;
    this.imageList = [];
    this.index = 0;
    this.timer = null;
    self = this;
  },

  // shuffles an array at random and returns it
  shuffleArray(array) {
    for (let i = array.length - 1; i > 0; i--) {
      // j is a random index in [0, i].
      const j = Math.floor(Math.random() * (i + 1));
      [array[i], array[j]] = [array[j], array[i]];
    }
    return array;
  },

  // sort by filename attribute
  sortByFilename(a, b) {
    const aL = a.path.toLowerCase();
    const bL = b.path.toLowerCase();
    if (aL > bL) return 1;
    return -1;
  },

  // sort by created attribute
  sortByCreated(a, b) {
    const aL = a.created;
    const bL = b.created;
    if (aL > bL) return 1;
    return -1;
  },

  // sort by created attribute
  sortByModified(a, b) {
    const aL = a.modified;
    const bL = b.modified;
    if (aL > bL) return 1;
    return -1;
  },

  sortImageList(imageList, sortBy, sortDescending) {
    let sortedList = imageList;
    switch (sortBy) {
      case 'created':
        // Log.log('Sorting by created date...');
        sortedList = imageList.sort(this.sortByCreated);
        break;
      case 'modified':
        // Log.log('Sorting by modified date...');
        sortedList = imageList.sort(this.sortByModified);
        break;
      default:
        // sort by name
        // Log.log('Sorting by name...');
        sortedList = imageList.sort(this.sortByFilename);
    }

    // If the user chose to sort in descending order then reverse the array
    if (sortDescending === true) {
      // Log.log('Reversing sort order...');
      sortedList = sortedList.reverse();
    }

    return sortedList;
  },

  // checks there's a valid image file extension
  checkValidImageFileExtension(filename) {
    if (!filename.includes('.')) {
      // No file extension.
      return false;
    }
    const fileExtension = filename.split('.').pop().toLowerCase();
    return this.validImageFileExtensions.has(fileExtension);
  },

  // gathers the image list
  gatherImageList(config, sendNotification) {
    // Invalid config. retrieve it again
    if (
      typeof config === 'undefined' ||
      !Object.hasOwn(Object(config), 'imagePaths')
    ) {
      this.sendSocketNotification('BACKGROUNDSLIDESHOW_REGISTER_CONFIG');
      return;
    }
    // create an empty main image list
    this.imageList = [];
    for (let i = 0; i < config.imagePaths.length; i++) {
      this.getFiles(config.imagePaths[i], this.imageList, config);
    }

    this.imageList = config.randomizeImageOrder
      ? this.shuffleArray(this.imageList)
      : this.sortImageList(
          this.imageList,
          config.sortImagesBy,
          config.sortImagesDescending
        );
    // Limit to 100 photos
    this.imageList = this.imageList.slice(0, 100);

    Log.info(`BACKGROUNDSLIDESHOW: ${this.imageList.length} files found`);
    this.index = 0;

    // let other modules know about slideshow images
    this.sendSocketNotification('BACKGROUNDSLIDESHOW_FILELIST', {
      imageList: this.imageList
    });

    // build the return payload
    const returnPayload = {
      identifier: config.identifier
    };

    // signal ready
    if (sendNotification) {
      this.sendSocketNotification('BACKGROUNDSLIDESHOW_READY', returnPayload);
    }
  },

  getNextImage() {
    if (!this.imageList.length || this.index >= this.imageList.length) {
      // if there are no images or all the images have been displayed, try loading the images again
      this.gatherImageList(this.config);
    }
    //
    if (!this.imageList.length) {
      // still no images, search again after 10 mins
      setTimeout(() => {
        this.getNextImage(this.config);
      }, 600000);
      return;
    }

    const image = this.imageList[this.index++];
    Log.info(`BACKGROUNDSLIDESHOW: reading path "${image.path}"`);
    self = this;
    this.readFile(image.path, (data) => {
      const returnPayload = {
        identifier: self.config.identifier,
        path: image.path,
        data,
        index: self.index,
        total: self.imageList.length
      };
      self.sendSocketNotification(
        'BACKGROUNDSLIDESHOW_DISPLAY_IMAGE',
        returnPayload
      );
    });

    // (re)set the update timer
    this.startOrRestartTimer();
  },

  // stop timer if it's running
  stopTimer() {
    if (this.timer) {
      Log.debug('BACKGROUNDSLIDESHOW: stopping update timer');
      const it = this.timer;
      this.timer = null;
      clearTimeout(it);
    }
  },
  // resume timer if it's not running; reset if it is
  startOrRestartTimer() {
    this.stopTimer();
    Log.debug('BACKGROUNDSLIDESHOW: restarting update timer');
    this.timer = setTimeout(() => {
      self.getNextImage();
    }, self.config?.slideshowSpeed || 10000);
  },

  getPrevImage() {
    // imageIndex is incremented after displaying an image so -2 is needed to
    // get to previous image index.
    this.index -= 2;

    // Case of first image, go to end of array.
    if (this.index < 0) {
      this.index = 0;
    }
    this.getNextImage();
  },

  resizeImage(input, callback) {
    Log.log(
      `resizing image to max: ${this.config.maxWidth}x${this.config.maxHeight}`
    );
    const transformer = sharp()
      .rotate()
      .resize({
        width: parseInt(this.config.maxWidth, 10),
        height: parseInt(this.config.maxHeight, 10),
        fit: 'inside'
      })
      .keepMetadata()
      .jpeg({ quality: 80 });

    // Streama image data from file to transformation and finally to buffer
    const outputStream = [];

    FileSystemImageSlideshow.createReadStream(input)
      .pipe(transformer) // Stream to Sharp för att resizea
      .on('data', (chunk) => {
        outputStream.push(chunk); // add chunks in a buffer array
      })
      .on('end', () => {
        const buffer = Buffer.concat(outputStream);
        callback(`data:image/jpg;base64, ${buffer.toString('base64')}`);
        Log.log('resizing done!');
      })
      .on('error', (err) => {
        Log.error('Error resizing image:', err);
      });
  },

  readFile(filepath, callback) {
    const ext = filepath.split('.').pop();

    if (this.config.resizeImages) {
      this.resizeImage(filepath, callback);
    } else {
      Log.log('resizeImages: false');
      // const data = FileSystemImageSlideshow.readFileSync(filepath, { encoding: 'base64' });
      // callback(`data:image/${ext};base64, ${data}`);
      const chunks = [];
      FileSystemImageSlideshow.createReadStream(filepath)
        .on('data', (chunk) => {
          chunks.push(chunk); // Samla chunkar av data
        })
        .on('end', () => {
          const buffer = Buffer.concat(chunks);
          callback(
            `data:image/${ext.slice(1)};base64, ${buffer.toString('base64')}`
          );
        })
        .on('error', (err) => {
          Log.error('Error reading file:', err);
        })
        .on('close', () => {
          Log.log('Stream closed.');
        });
    }
  },

  getFiles(imagePath, imageList, config) {
    Log.info(
      `BACKGROUNDSLIDESHOW: Reading directory "${imagePath}" for images.`
    );
    const contents = FileSystemImageSlideshow.readdirSync(imagePath);
    for (let i = 0; i < contents.length; i++) {
      if (this.excludePaths.has(contents[i])) {
        continue;
      }
      const currentItem = `${imagePath}/${contents[i]}`;
      const stats = FileSystemImageSlideshow.lstatSync(currentItem);
      if (stats.isDirectory() && config.recursiveSubDirectories) {
        this.getFiles(currentItem, imageList, config);
      } else if (stats.isFile()) {
        const isValidImageFileExtension =
          this.checkValidImageFileExtension(currentItem);
        if (isValidImageFileExtension) {
          imageList.push({
            path: currentItem,
            created: stats.ctimeMs,
            modified: stats.mtimeMs
          });
        }
      }
    }
  },

  async getReverseGeocodeInfo(data, callback) {
    const description = await reverseGeocode(data, 'it-IT', this.path);

    if (description) {
      callback(description);
    } else {
      Log.error(
        `Reverse geocode failed (${JSON.stringify(location, null, 2)})`
      );
    }
  },

  // subclass socketNotificationReceived, received notification from module
  socketNotificationReceived(notification, payload) {
    if (notification === 'BACKGROUNDSLIDESHOW_REGISTER_CONFIG') {
      const config = payload;
      this.expressInstance.use(
        basePath + config.imagePaths[0],
        express.static(config.imagePaths[0], { maxAge: 3600000 })
      );

      // Create set of excluded subdirectories.
      this.excludePaths = new Set(config.excludePaths);

      // Create set of valid image extensions.
      const validExtensionsList = config.validImageFileExtensions
        .toLowerCase()
        .split(',');
      this.validImageFileExtensions = new Set(validExtensionsList);

      // Get the image list in a non-blocking way since large # of images would cause
      // the MagicMirror startup banner to get stuck sometimes.
      this.config = config;
      setTimeout(() => {
        this.gatherImageList(config, true);
        this.getNextImage();
      }, 200);
    } else if (notification === 'BACKGROUNDSLIDESHOW_PLAY_VIDEO') {
      Log.info('mw got BACKGROUNDSLIDESHOW_PLAY_VIDEO');
      Log.info(
        `cmd line: omxplayer --win 0,0,1920,1080 --alpha 180 ${payload[0]}`
      );
      exec(
        `omxplayer --win 0,0,1920,1080 --alpha 180 ${payload[0]}`,
        (e, stdout, stderr) => {
          this.sendSocketNotification('BACKGROUNDSLIDESHOW_PLAY', null);
          Log.info('mw video done');
        }
      );
    } else if (notification === 'BACKGROUNDSLIDESHOW_NEXT_IMAGE') {
      Log.info('BACKGROUNDSLIDESHOW_NEXT_IMAGE');
      this.getNextImage();
    } else if (notification === 'BACKGROUNDSLIDESHOW_PREV_IMAGE') {
      Log.info('BACKGROUNDSLIDESHOW_PREV_IMAGE');
      this.getPrevImage();
    } else if (notification === 'BACKGROUNDSLIDESHOW_PAUSE') {
      this.stopTimer();
    } else if (notification === 'BACKGROUNDSLIDESHOW_PLAY') {
      this.startOrRestartTimer();
    } else if (notification === 'BACKGROUNDSLIDESHOW_REVERSE_GEOCODE') {
      this.getReverseGeocodeInfo(payload, (description) => {
        if (description) {
          this.sendSocketNotification(
            'BACKGROUNDSLIDESHOW_DISPLAY_LOCATION',
            description
          );
        }
      });
    }
  }
});
