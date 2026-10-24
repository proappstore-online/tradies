import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { readFileSync } from 'node:fs'
import { parseRoute, listingPath, jobPath } from '../web/src/routes.ts'
const read = file => JSON.parse(readFileSync(new URL(file, import.meta.url), 'utf8'))
const manifest = read('../mcp.json')
const db = new DatabaseSync(':memory:')
for (const migration of read('../migrations.json').migrations) db.exec(migration.sql)
const tools = Object.fromEntries(manifest.tools.map(tool => [tool.name, tool]))
const query = (name, params) => db.prepare(tools[name].sql).all(Object.fromEntries(Object.entries(params).map(([k,v]) => [`:${k}`,v])))

for (const [pathname, hash, expected] of [
  ['/l/listing-1', '', {name:'listing',id:'listing-1'}],
  ['/jobs/open-1/', '', {name:'job',id:'open-1'}],
  ['/l/profile%3A1', '', {name:'listing',id:'profile:1'}],
  ['/l/listing-1', '#main', {name:'listing',id:'listing-1'}],
  ['/', '#/l/listing-1', {name:'listing',id:'listing-1'}],
  ['/', '#/jobs/draft-1', {name:'job',id:'draft-1'}],
  ['/l/listing-1', '#/quotes', {name:'quotes'}],
  ['/', '#/work/job/open-1/gh:42', {name:'workThread',targetType:'job',targetId:'open-1',otherId:'gh:42'}],
  ['/l/%2Fsecret', '', {name:'browse'}],
  ['/l/%ZZ', '', {name:'browse'}],
]) assert.deepEqual(parseRoute({pathname,hash}), expected)
assert.equal(listingPath('profile:1'),'/l/profile:1')
assert.equal(jobPath('open-1'),'/jobs/open-1')

for (const [id,status] of [['active-1','active'],['paused-1','paused'],['archived-1','archived']]) {
  db.prepare('INSERT INTO listings(id,owner_id,owner_name,status,title,description,category,location,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)').run(id,'private-owner','Display name',status,'Public profile','Public summary','plumber','Melbourne',1,2)
}
for (const [id,status,lifecycle] of [['open-1','open','open'],['draft-1','open','draft'],['closed-1','closed','closed'],['hidden-1','closed','open']]) {
  db.prepare('INSERT INTO jobs(id,customer_id,status,lifecycle,title,description,category,location,private_address,contact_details,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)').run(id,'private-customer',status,lifecycle,'Public job','Public work summary','plumber','Melbourne','PRIVATE ADDRESS','PRIVATE CONTACT',1,2)
}
assert.equal(query('public_listing_meta',{id:'active-1'})[0].title,'Public profile — Tradies')
assert.equal(query('public_job_meta',{id:'open-1'})[0].title,'Public job — Tradies')
for (const id of ['paused-1','archived-1','missing']) assert.equal(query('public_listing_meta',{id}).length,0)
for (const id of ['draft-1','closed-1','hidden-1','missing']) assert.equal(query('public_job_meta',{id}).length,0)
for (const name of ['public_listing_meta','public_job_meta']) {
  const row=query(name,{id:name==='public_listing_meta'?'active-1':'open-1'})[0]
  assert.deepEqual(Object.keys(row).sort(),['description','image_url','title'])
  assert.doesNotMatch(JSON.stringify(row),/private-owner|private-customer|PRIVATE ADDRESS|PRIVATE CONTACT/)
}
assert.deepEqual(query('public_sitemap_urls',{cursor:''}).map(row=>row.path),['/','/jobs/open-1','/l/active-1'])
assert.deepEqual(query('public_sitemap_urls',{cursor:'/jobs/open-1'}).map(row=>row.path),['/l/active-1'])
for (const route of manifest.page_meta) {
  assert.equal(route.not_found,404)
  assert.equal(tools[route.action].requires_auth,false)
  assert.equal(tools[route.action].operation,'query')
}
// Multiple pages prove the keys-only sitemap neither truncates nor loops on its cursor.
const insert=db.prepare('INSERT INTO listings(id,owner_id,status,title,category,created_at,updated_at) VALUES(?,?,?,?,?,?,?)')
for(let n=0;n<505;n++) insert.run(`page-${String(n).padStart(3,'0')}`,'private-owner','active','Profile','plumber',1,2)
const pages=[];let cursor=''
for(;;){const rows=query('public_sitemap_urls',{cursor});if(!rows.length)break;pages.push(...rows);cursor=rows.at(-1).path}
assert.equal(pages.length,508)
assert.equal(new Set(pages.map(row=>row.path)).size,508)
assert.deepEqual(pages.map(row=>row.path),pages.map(row=>row.path).sort())
console.log('PASS: stable and legacy routes, public metadata privacy/lifecycle, missing records and sitemap keyset pagination')
