import { describe, it, expect } from 'vitest';
import path from 'path';
import fs from 'fs/promises';
import { R49Archive } from '@occupancy/r49';
import { NodeClassifier } from '../src/node';

function getPaths() {
  const cwd = process.cwd();
  const isPackageRoot = cwd.endsWith('classifier');
  const baseDir = isPackageRoot ? path.resolve(cwd, '../..') : cwd;
  
  return {
    modelPath: path.resolve(baseDir, 'classifier/resnet/models/model_int8.ort'),
    configPath: path.resolve(baseDir, 'classifier/resnet/models/config.json'),
    datasetDir: path.resolve(baseDir, 'dataset/r49'),
  };
}

describe('Classifier Regression Tests', () => {
  it('achieves >= 99.5% classification accuracy on the dataset', async () => {
    const { modelPath, configPath, datasetDir } = getPaths();

    // Check if model files exist; if they don't, skip the test with a helpful message (or fail if in CI)
    let modelExists = false;
    try {
      await fs.access(modelPath);
      await fs.access(configPath);
      modelExists = true;
    } catch {
      modelExists = false;
    }

    if (!modelExists) {
      if (process.env.CI === 'true') {
        throw new Error(`Model files not found at ${modelPath} or ${configPath} in CI environment.`);
      }
      console.warn(`Skipping regression test: model files not found at ${modelPath} or ${configPath}.`);
      return;
    }

    // Load configuration
    const configData = await fs.readFile(configPath, 'utf8');
    const modelConfig = JSON.parse(configData);
    const labels = modelConfig.labels;

    // Instantiate classifier
    const classifier = new NodeClassifier(modelConfig);
    await classifier.load(modelPath);

    // Find all .r49 archives
    const files = await fs.readdir(datasetDir);
    const archives = files.filter(f => f.endsWith('.r49'));
    expect(archives.length).toBeGreaterThan(0);

    let totalCount = 0;
    let correctCount = 0;

    for (const archiveName of archives) {
      const archivePath = path.join(datasetDir, archiveName);
      const data = await fs.readFile(archivePath);
      const archive = await R49Archive.load(data);
      const manifest = archive.getManifest();

      for (const image of manifest.images) {
        const imgData = await archive.getImage(image.filename);
        if (!imgData) continue;

        for (const [id, marker] of Object.entries(image.labels)) {
          let trueLabel = marker.type || 'unknown';
          if (trueLabel === 'train-end') trueLabel = 'train';
          if (!labels.includes(trueLabel)) continue;

          const imgDpt = NodeClassifier.calculateDpt(manifest);
          const predLabels = await classifier.classify(Buffer.from(imgData), marker, imgDpt);

          totalCount++;
          if (predLabels.includes(trueLabel)) {
            correctCount++;
          }
        }
      }
    }

    await classifier.release();

    expect(totalCount).toBeGreaterThan(0);
    const accuracy = correctCount / totalCount;
    console.log(`Regression Test Results: Correct: ${correctCount}/${totalCount} (${(accuracy * 100).toFixed(2)}% accuracy)`);
    expect(accuracy).toBeGreaterThanOrEqual(0.995);
  }, 60000);
});
