Here is a complete, copy-ready Contributor License Agreement (CLA) template designed specifically to protect your right to change or upgrade the project's license in the future, while centralizing all community modifications into your official repository.
------------------------------
## Contributor License Agreement (CLA)
Thank you for your interest in contributing to this project. This Contributor License Agreement ("Agreement") ensures that the project can safely accept your contributions and remain legally sustainable, while preserving our ability to adapt our licensing model in the future.
By submitting a contribution (e.g., via a GitHub Pull Request, Issue, or commit), you agree to the following terms:
## 1. Definitions

* "You" means the individual or legal entity making the contribution.
* "Project" means the software project and repository owned and managed by the Project Owner.
* "Contribution" means any source code, documentation, bug fixes, or other modifications intentionally submitted by You for inclusion in the Project.

## 2. Grant of Copyright License
You hereby grant to the Project Owner a perpetual, worldwide, non-exclusive, no-charge, royalty-free, irrevocable copyright license to reproduce, prepare derivative works of, publicly display, publicly perform, sublicense, and distribute Your Contributions and such derivative works.
## 3. Right to Re-License and Relocate
You explicitly agree that the Project Owner holds the absolute right to change, modify, or upgrade the software license of the Project at any time in the future. This includes, but is not limited to:

* Moving from a copyleft license (e.g., GPL) to a permissive license (e.g., MIT, Apache 2.0).
* Moving to a weak copyleft license (e.g., MPL).
* Moving to a source-available, custom, or commercial/proprietary license model.

The Project Owner is authorized to re-license Your past, present, and future Contributions under any such new terms without requiring additional permission or notice.
## 4. Grant of Patent License
You hereby grant to the Project Owner a perpetual, worldwide, non-exclusive, no-charge, royalty-free, irrevocable patent license to make, have made, use, offer to sell, sell, import, and otherwise transfer the Project, where such license applies only to those patent claims licensable by You that are necessarily infringed by Your Contribution(s) alone or by combination of Your Contribution(s) with the Project.
## 5. Representational Authority
You represent that You are legally entitled to grant these licenses. If your employer has rights to intellectual property you create, you represent that you have received permission to make such contributions on behalf of that employer, or that your employer has waived such rights for this Project.
## 6. No Warranty
Except for the representations explicitly stated in Section 5, Your Contributions are provided on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied, including, without limitation, any warranties or conditions of TITLE, NON-INFRINGEMENT, MERCHANTABILITY, or FITNESS FOR A PARTICULAR PURPOSE.
------------------------------
## How to Implement This on GitHub

   1. Save the File: Create a file named CLA.md in the root directory of your repository and paste the text above into it.
   2. Automate the Check: Do not manually check every pull request. Use a free GitHub action or service like CLA Assistant (cla-assistant.io) or EasyCLA.
   3. The Workflow: When a developer opens a Pull Request, the automated bot will comment on their PR asking them to sign. They click a link, log into GitHub, and accept the terms. The bot then marks the PR check as passed, allowing you to safely merge the code.

If you want, I can help you write the configuration file to set up a CLA check directly inside a GitHub Actions workflow. Let me know if you would like to do that.

