import fs from 'fs/promises';
import path from 'path';
import { R49Archive } from '@occupancy/r49';
import { NodeClassifier } from '@occupancy/classifier/node';

const DATA_DIR = 'r49';
const MODEL_PATH = '../classifier/resnet/models/model.onnx';
const CONFIG_PATH = '../classifier/resnet/models/config.json';

async function getAllFiles(dir: string): Promise<string[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files = await Promise.all(entries.map((res) => {
    const resPath = path.resolve(dir, res.name);
    return res.isDirectory() ? getAllFiles(resPath) : resPath;
  }));
  return Array.prototype.concat(...files);
}

async function main() {
  const allFiles = await getAllFiles(DATA_DIR);
  const archives = allFiles.filter(f => f.endsWith('.r49'));
  console.log(`Found ${archives.length} archives`);

  const modelConfig = JSON.parse(await fs.readFile(CONFIG_PATH, 'utf-8'));
  const labels = modelConfig.labels;

  const classifier = new NodeClassifier(modelConfig);
  await classifier.load(MODEL_PATH);

  const confusionMatrix: Record<string, Record<string, number>> = {};
  for (const label of labels) {
    confusionMatrix[label] = {};
    for (const pred of labels) {
      confusionMatrix[label][pred] = 0;
    }
  }

  for (const archivePath of archives) {
    const data = await fs.readFile(archivePath);
    const archive = await R49Archive.load(data);
    const manifest = archive.getManifest();

    for (const image of manifest.images) {
      const imgData = await archive.getImage(image.filename);
      if (!imgData) continue;

      for (const [id, marker] of Object.entries(image.labels)) {
        let trueLabel = marker.type || 'unknown';
        if (trueLabel === 'train-end') trueLabel = 'train'; // LABEL_MAP in data_prep.ts
        if (!labels.includes(trueLabel)) continue; // ignore things not in classes

        const imgDpt = NodeClassifier.calculateDpt(manifest);
        const predLabel = await classifier.classify(imgData, marker, imgDpt);
        confusionMatrix[trueLabel][predLabel]++;
      }
    }
  }

  console.log('\nConfusion Matrix (True \\ Pred):');
  console.log(''.padEnd(12) + labels.map(l => l.padStart(12)).join(''));
  for (const trueLabel of labels) {
    const row = [trueLabel.padEnd(12)];
    for (const predLabel of labels) {
      row.push(confusionMatrix[trueLabel][predLabel].toString().padStart(12));
    }
    console.log(row.join(''));
  }

  // Save to JSON for comparison
  const outputPath = '../classifier/resnet/results/online_confusion_matrix.json';
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, JSON.stringify({
    labels,
    matrix: confusionMatrix
  }, null, 2));
  console.log(`\nSaved confusion matrix to ${outputPath}`);
}

main().catch(console.error);
