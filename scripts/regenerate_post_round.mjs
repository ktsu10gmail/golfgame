#!/usr/bin/env node
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {improvePostRoundReport,coachingReportMarkdown} from '../packages/presentation/post_round_coaching.mjs';
const [inputName,prefix]=process.argv.slice(2);
if(!inputName||!prefix)throw Error('Usage: node scripts/regenerate_post_round.mjs INPUT.json OUTPUT_PREFIX (writes .json, .md, .html; never overwrites files)');
const input=resolve(inputName),output=resolve(prefix);
if(['.json','.md','.html'].some(extension=>output+extension===input))throw Error('Output must not replace the input report.');
const source=await readFile(input);const original=JSON.parse(source);
const report=improvePostRoundReport(original);
report.coaching_review.regenerated_at=new Date().toISOString();
report.coaching_review.audit.source_file_sha256=createHash('sha256').update(source).digest('hex');
for(const key of ['round','scorecard','detailed_shots','source_round'])if(JSON.stringify(report[key])!==JSON.stringify(original[key]))throw Error('Original round evidence changed: '+key);
const markdown=coachingReportMarkdown(report);
const escape=value=>value.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
const inline=value=>escape(value).replace(/\*\*(.*?)\*\*/g,'<strong>$1</strong>');
const content=markdown.split('\n\n').map(block=>{
 if(block.startsWith('## '))return '<h2>'+inline(block.slice(3))+'</h2>';
 if(block.startsWith('# '))return '<h1>'+inline(block.slice(2))+'</h1>';
 if(block.startsWith('- '))return '<ul>'+block.split('\n').map(line=>'<li>'+inline(line.replace(/^- /,''))+'</li>').join('')+'</ul>';
 return '<p>'+inline(block)+'</p>';
}).join('\n');
const html='<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Jetta round review</title><style>body{margin:40px auto;max-width:780px;padding:0 24px;background:#faf9f4;color:#25372d;font:18px/1.65 system-ui,sans-serif}h1,h2{line-height:1.25}h2{margin-top:2em}p,li{margin-bottom:1em}strong{color:#173e2a}@media print{body{margin:0;max-width:none;background:white;font-size:11pt}h2{break-after:avoid}li{break-inside:avoid}}</style><main>'+content+'</main></html>\n';
for(const [extension,text]of [['.json',JSON.stringify(report,null,2)+'\n'],['.md',markdown],['.html',html]])await writeFile(output+extension,text,{flag:'wx',mode:0o600});
console.log(JSON.stringify({files:['.json','.md','.html'].map(extension=>output+extension),score:report.round.score,recorded_shots:report.detailed_shots.length,corrected_flags:report.coaching_review.editor.corrected_report_flags.length,practice_priority:report.summary.practice_priority,source_unchanged:true},null,2));
