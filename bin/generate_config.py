#!/usr/bin/env python3
import yaml
import json
import os

def main():
    # Set working directory to project root (parent of bin/)
    project_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    yaml_path = os.path.join(project_root, "config.yaml")
    json_path = os.path.join(project_root, "config.json")

    if not os.path.exists(yaml_path):
        print(f"❌ Error: config.yaml not found at {yaml_path}")
        exit(1)

    try:
        with open(yaml_path, "r") as f:
            config_data = yaml.safe_load(f)
    except Exception as e:
        print(f"❌ Error parsing config.yaml: {e}")
        exit(1)

    try:
        with open(json_path, "w") as f:
            json.dump(config_data, f, indent=2)
        print(f"✅ Successfully compiled {yaml_path} to {json_path}")
    except Exception as e:
        print(f"❌ Error writing config.json: {e}")
        exit(1)

if __name__ == "__main__":
    main()
