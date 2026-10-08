import { readFileSync } from 'node:fs';
import { validateMapperProject, mapperHoleCount, holeMappingStatus } from '../packages/editor/course_mapper.mjs';

try {
  const project = JSON.parse(readFileSync(0, 'utf8'));
  const assessment = project.external_course_source?.layout_assessment;
  if (assessment?.unsupported || assessment?.ambiguous) {
    throw new Error(assessment.reason || 'Unsupported or ambiguous hole grouping');
  }
  validateMapperProject(project);
  const holes = Array.from({ length: mapperHoleCount(project) }, (_, i) => ({
    hole: i + 1, ...holeMappingStatus(project, i + 1)
  }));
  console.log(JSON.stringify({ ready: holes.every(h => h.ready), holes }));
} catch (error) {
  console.log(JSON.stringify({ ready: false, invalid: true, error: error.message }));
  process.exitCode = 1;
}
