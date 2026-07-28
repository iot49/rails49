import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import sharp from 'sharp';
import yaml from 'js-yaml';
import { R49Archive, getDPT } from '@occupancy/r49';

// Load config manually as per TODO.md
const configPath = path.resolve(process.cwd(), '../config.yaml');
const config = yaml.load(await fs.readFile(configPath, 'utf8')) as any;

const DATA_DIR = 'r49';
const DB_DIR = 'data';
const EXCLUDE_FILE = 'exclude.json';
if (!config || !config.cnn) {
  throw new Error("Fatal Error: 'cnn' configuration section is missing in config.yaml.");
}

const CROP_SIZE = config.cnn.crop_size_prep;
const SAMPLE_DPT = config.cnn.sample_dpt;
const VAL_SPLIT = config.cnn.val_split;

if (CROP_SIZE === undefined || CROP_SIZE === null || isNaN(CROP_SIZE)) {
  throw new Error("Fatal Error: 'cnn.crop_size_prep' is missing or invalid in config.yaml.");
}
if (SAMPLE_DPT === undefined || SAMPLE_DPT === null || isNaN(SAMPLE_DPT)) {
  throw new Error("Fatal Error: 'cnn.sample_dpt' is missing or invalid in config.yaml.");
}
if (VAL_SPLIT === undefined || VAL_SPLIT === null || isNaN(VAL_SPLIT)) {
  throw new Error("Fatal Error: 'cnn.val_split' is missing or invalid in config.yaml.");
}

let EXCLUSIONS: Set<string> = new Set();

async function loadExclusions() {
  try {
    const data = await fs.readFile(EXCLUDE_FILE, 'utf-8');
    const list = JSON.parse(data);
    EXCLUSIONS = new Set(list);
    console.log(`Loaded ${EXCLUSIONS.size} exclusions`);
  } catch (err) {
    console.log('No exclusions found or error loading exclude.json');
  }
}

const LABEL_MAP: Record<string, string> = {
  'train-end': 'train',
  'coupling': 'train coupling',
};

const INTERESTED_LABELS = new Set(['train', 'train coupling', 'track']);

interface DataRecord {
  label_id: string;
  labels: string;
  is_valid: boolean;
  archive: string;
}

const records: DataRecord[] = [];

async function ensureDir(dir: string) {
  try {
    await fs.access(dir);
  } catch {
    await fs.mkdir(dir, { recursive: true });
  }
}

function getIsValid(archiveName: string, imageName: string, markerId: string): boolean {
  const key = `${archiveName}:${imageName}:${markerId}`;
  const hash = crypto.createHash('md5').update(key).digest('hex');
  const val = parseInt(hash.substring(0, 8), 16);
  return (val % 100) < (VAL_SPLIT * 100);
}

async function getAllFiles(dir: string): Promise<string[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files = await Promise.all(entries.map((res) => {
    const resPath = path.resolve(dir, res.name);
    return res.isDirectory() ? getAllFiles(resPath) : resPath;
  }));
  return Array.prototype.concat(...files);
}

async function processArchive(filePath: string) {
  const relativePath = path.relative(DATA_DIR, filePath);
  const archiveName = relativePath.replace(/[/\\]/g, '_');
  
  console.log(`  Loading ${relativePath}...`);
  const data = await fs.readFile(filePath);
  const archive = await R49Archive.load(data);
  const manifest = archive.getManifest();

  // Calculate resolution-based scaling (same for all images in a .r49 file)
  const imgDpt = getDPT(manifest) ?? SAMPLE_DPT;
  const scaleFactor = imgDpt / SAMPLE_DPT;

  if (scaleFactor < 1 / 1.2) {
    console.warn(`  Skipping ${relativePath}: Resolution too low (${Math.round(imgDpt)} DPT < target ${SAMPLE_DPT} DPT). Upscaling > 1.2x not allowed.`);
    return;
  }

  for (const image of manifest.images) {
    const imgData = await archive.getImage(image.filename);
    if (!imgData) {
      console.warn(`    Image ${image.filename} not found in ${relativePath}`);
      continue;
    }

    const pipeline = sharp(Buffer.from(imgData));
    const metadata = await pipeline.metadata();
    if (!metadata.width || !metadata.height) {
      console.warn(`    Could not get metadata for ${image.filename} in ${relativePath}`);
      continue;
    }

    for (const [id, marker] of Object.entries(image.labels)) {
      if (EXCLUSIONS.has(id)) {
        console.log(`    Skipping excluded marker ${id} in ${image.filename}`);
        continue;
      }

      let label = marker.type || 'unknown';
      label = LABEL_MAP[label] || label;
      
      if (!INTERESTED_LABELS.has(label)) {
        continue;
      }
      
      const isValid = getIsValid(archiveName, image.filename, id);
      
      const x = Math.round(marker.x);
      const y = Math.round(marker.y);
      const scaledCropSize = Math.round(CROP_SIZE * scaleFactor);
      const half = Math.floor(scaledCropSize / 2);

      let left = x - half;
      let top = y - half;
      let width = scaledCropSize;
      let height = scaledCropSize;
      
      // Handle edge cases (clamping)
      if (left < 0) left = 0;
      if (top < 0) top = 0;
      if (left + width > metadata.width) left = metadata.width - width;
      if (top + height > metadata.height) top = metadata.height - height;

      if (left < 0 || top < 0 || width > metadata.width || height > metadata.height) {
        console.warn(`    Marker ${id} in ${relativePath}/${image.filename} is too large for image dimensions`);
        continue;
      }

      const outputName = `${id}.jpg`;
      const outputPath = path.join(DB_DIR, outputName);

      await pipeline
        .clone()
        .extract({ left, top, width, height })
        .resize({ width: CROP_SIZE, height: CROP_SIZE })
        .toFile(outputPath);

      records.push({
        label_id: id,
        labels: label, // Single label for now, but stored in a string field as requested
        is_valid: isValid,
        archive: relativePath
      });
    }
  }
}

async function main() {
  await ensureDir(DATA_DIR);
  
  // Clean output directory to ensure a fresh dataset
  await fs.rm(DB_DIR, { recursive: true, force: true });
  await ensureDir(DB_DIR);
  await loadExclusions();

  const allFiles = await getAllFiles(DATA_DIR);
  const archives = allFiles.filter(f => f.endsWith('.r49'));

  console.log(`Found ${archives.length} archives`);
  for (const archive of archives) {
    try {
      await processArchive(archive);
    } catch (err) {
      console.error(`  Error processing ${archive}:`, err);
    }
  }

  // Write data.csv
  const csvHeader = 'label_id,labels,is_valid,archive\n';
  const csvRows = records.map(r => 
    `${r.label_id},"${r.labels}",${r.is_valid},"${r.archive}"`
  ).join('\n');
  
  await fs.writeFile(path.join(DB_DIR, 'data.csv'), csvHeader + csvRows);

  console.log(`Done! Processed ${records.length} samples.`);
}

main().catch(console.error);
