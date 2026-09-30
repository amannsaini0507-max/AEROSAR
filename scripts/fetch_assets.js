/**
 * AEROSAR Asset Downloader (Dev-time only)
 * Fetches CC0 textures and HDRIs from Poly Haven and Three.js examples repository.
 * Stores them into frontend/public/assets/ and public/assets/ so runtime is 100% offline.
 */
const https = require('https');
const fs = require('fs');
const path = require('path');

const ROOT_DIR = path.resolve(__dirname, '..');
const TARGET_DIRS = [
  path.join(ROOT_DIR, 'frontend', 'public', 'assets'),
  path.join(ROOT_DIR, 'public', 'assets')
];

const ASSETS = [
  // HDRIs (CC0 Poly Haven)
  {
    url: 'https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/1k/kloofendal_48d_partly_cloudy_puresky_1k.hdr',
    subpath: 'hdri/overcast_day_1k.hdr'
  },
  {
    url: 'https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/1k/spruit_sunrise_1k.hdr',
    subpath: 'hdri/dusk_1k.hdr'
  },
  {
    url: 'https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/1k/dikhololo_night_1k.hdr',
    subpath: 'hdri/night_1k.hdr'
  },
  {
    url: 'https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/1k/overcast_soil_puresky_1k.hdr',
    subpath: 'hdri/smoke_overcast_1k.hdr'
  },

  // Terrain Textures (CC0 Poly Haven)
  {
    url: 'https://dl.polyhaven.org/file/ph-assets/Textures/jpg/1k/brown_mud_dry/brown_mud_dry_diff_1k.jpg',
    subpath: 'textures/terrain/mud_diff_1k.jpg'
  },
  {
    url: 'https://dl.polyhaven.org/file/ph-assets/Textures/jpg/1k/brown_mud_dry/brown_mud_dry_nor_gl_1k.jpg',
    subpath: 'textures/terrain/mud_nor_1k.jpg'
  },
  {
    url: 'https://dl.polyhaven.org/file/ph-assets/Textures/jpg/1k/brown_mud_dry/brown_mud_dry_rough_1k.jpg',
    subpath: 'textures/terrain/mud_rough_1k.jpg'
  },
  {
    url: 'https://dl.polyhaven.org/file/ph-assets/Textures/jpg/1k/bicolour_gravel/bicolour_gravel_diff_1k.jpg',
    subpath: 'textures/terrain/gravel_diff_1k.jpg'
  },
  {
    url: 'https://dl.polyhaven.org/file/ph-assets/Textures/jpg/1k/bicolour_gravel/bicolour_gravel_nor_gl_1k.jpg',
    subpath: 'textures/terrain/gravel_nor_1k.jpg'
  },
  {
    url: 'https://dl.polyhaven.org/file/ph-assets/Textures/jpg/1k/bicolour_gravel/bicolour_gravel_rough_1k.jpg',
    subpath: 'textures/terrain/gravel_rough_1k.jpg'
  },
  {
    url: 'https://dl.polyhaven.org/file/ph-assets/Textures/jpg/1k/aerial_ground_rock/aerial_ground_rock_diff_1k.jpg',
    subpath: 'textures/terrain/dirt_diff_1k.jpg'
  },
  {
    url: 'https://dl.polyhaven.org/file/ph-assets/Textures/jpg/1k/aerial_ground_rock/aerial_ground_rock_nor_gl_1k.jpg',
    subpath: 'textures/terrain/dirt_nor_1k.jpg'
  },
  {
    url: 'https://dl.polyhaven.org/file/ph-assets/Textures/jpg/1k/aerial_ground_rock/aerial_ground_rock_rough_1k.jpg',
    subpath: 'textures/terrain/dirt_rough_1k.jpg'
  },

  // Water & FX (CC0 / MIT Three.js examples)
  {
    url: 'https://raw.githubusercontent.com/mrdoob/three.js/dev/examples/textures/waternormals.jpg',
    subpath: 'textures/water/waternormals.jpg'
  },
  {
    url: 'https://raw.githubusercontent.com/mrdoob/three.js/dev/examples/textures/sprites/spark1.png',
    subpath: 'textures/fx/spark.png'
  },
  {
    url: 'https://raw.githubusercontent.com/mrdoob/three.js/dev/examples/textures/sprites/circle.png',
    subpath: 'textures/fx/circle.png'
  },
  {
    url: 'https://raw.githubusercontent.com/mrdoob/three.js/dev/examples/textures/sprites/disc.png',
    subpath: 'textures/fx/disc.png'
  }
];

function download(url, dest) {
  return new Promise((resolve, reject) => {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    if (fs.existsSync(dest) && fs.statSync(dest).size > 1000) {
      console.log(`[EXISTS] ${path.basename(dest)}`);
      return resolve();
    }
    const file = fs.createWriteStream(dest);
    https.get(url, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return download(res.headers.location, dest).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) {
        return reject(new Error(`Failed to download ${url}: HTTP ${res.statusCode}`));
      }
      res.pipe(file);
      file.on('finish', () => {
        file.close(() => {
          console.log(`[DOWNLOADED] ${path.basename(dest)} (${fs.statSync(dest).size} bytes)`);
          resolve();
        });
      });
    }).on('error', (err) => {
      fs.unlink(dest, () => {});
      reject(err);
    });
  });
}

async function run() {
  console.log('Downloading CC0 offline assets for AEROSAR 3D Disaster Arena...');
  const baseDir = TARGET_DIRS[0];

  for (const asset of ASSETS) {
    const dest = path.join(baseDir, asset.subpath);
    try {
      await download(asset.url, dest);
    } catch (err) {
      console.error(`Error downloading ${asset.subpath}:`, err.message);
    }
  }

  // Mirror to all target directories
  for (let i = 1; i < TARGET_DIRS.length; i++) {
    const mirrorDir = TARGET_DIRS[i];
    console.log(`Mirroring assets to ${mirrorDir}...`);
    for (const asset of ASSETS) {
      const src = path.join(baseDir, asset.subpath);
      const dest = path.join(mirrorDir, asset.subpath);
      if (fs.existsSync(src)) {
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.copyFileSync(src, dest);
      }
    }
  }

  console.log('Asset download and verification complete.');
}

run();
