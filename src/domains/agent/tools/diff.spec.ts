import { parseAddedLines } from './diff';

const DIFF = `diff --git a/src/app.py b/src/app.py
index 1..2 100644
--- a/src/app.py
+++ b/src/app.py
@@ -1,4 +1,5 @@
 import os
-x = 1
+x = 2
+y = os.system(cmd)
 print(x)
@@ -20,2 +21,3 @@ def f():
     pass
+    return 1
diff --git a/old.txt b/old.txt
deleted file mode 100644
--- a/old.txt
+++ /dev/null
@@ -1 +0,0 @@
-gone
diff --git a/new.tf b/new.tf
new file mode 100644
--- /dev/null
+++ b/new.tf
@@ -0,0 +1,2 @@
+resource "x" "y" {}
+# end
`;

describe('parseAddedLines', () => {
  it('maps added lines to new-file line numbers', () => {
    const files = parseAddedLines(DIFF);
    expect([...files.get('src/app.py')!]).toEqual([2, 3, 22]);
    expect([...files.get('new.tf')!]).toEqual([1, 2]);
    expect(files.has('old.txt')).toBe(false);
  });
});
