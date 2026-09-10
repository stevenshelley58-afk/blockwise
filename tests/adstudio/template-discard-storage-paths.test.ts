import assert from 'node:assert/strict';
import {it} from 'node:test';
import {discardTemplate} from '../../src/lib/adstudio/template-review.ts';

it('discards the real decoded object keys, not URL-encoded prefixes, before deleting metadata', async () => {
  const operations: string[] = [];
  const service = {
    from(table: string) {
      let kind = 'read';
      const query = {
        select() { return query; },
        eq() { return query; },
        neq() { return query; },
        update() { kind = 'update'; return query; },
        delete() { kind = 'delete'; return query; },
        maybeSingle() { return Promise.resolve({data:{library_status:'quarantined'},error:null}); },
        then(resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) {
          operations.push(`${table}:${kind}`);
          return Promise.resolve({data: table==='ad_template_assets_direct' && kind==='read' ? [
            {storage_path:'templates/sample/hero-demo%2Fphoto-0.png'},
            {storage_path:'templates/sample/logo-logo.png'},
          ] : [], error:null, count:0}).then(resolve,reject);
        },
      };
      return query;
    },
    storage:{from(bucket: string){
      assert.equal(bucket,'workspace-artifacts');
      return {async remove(paths: string[]){
        assert.deepEqual(paths,['templates/sample/hero-demo/photo-0.png','templates/sample/logo-logo.png']);
        operations.push('storage:remove');
        return {error:null};
      }};
    }},
  };
  const result = await discardTemplate(service as never,'sample','run-test','revision');
  assert.equal(result.status,'discarded');
  assert.ok(operations.indexOf('storage:remove') < operations.indexOf('ad_template_assets_direct:delete'));
  assert.ok(operations.indexOf('storage:remove') < operations.indexOf('ad_templates:delete'));
});
