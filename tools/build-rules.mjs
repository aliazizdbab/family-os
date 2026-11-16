/**
 * Generates database.rules.json for Family OS.
 *
 *   node tools/build-rules.mjs
 *
 * The v3 platform enforces, server-side in Realtime Database Security Rules:
 *   - Staff RBAC (owner / developer / support) for the admin portal.
 *   - Strict family isolation: a signed-in member can only reach /v3/families/{own fid}.
 *   - Family RBAC (admin / mother / member / child) inside each family.
 *   - No password material is ever accepted into the database.
 *   - Append-only audit trail for administrative actions.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { OWNER_EMAIL, FAMILY_ROLES, STAFF_ROLES, FAMILY_STATUSES } from '../public/js/identity.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');
const rulesPath = path.join(projectRoot, 'database.rules.json');

const or = (...parts) => `(${parts.filter(Boolean).join(' || ')})`;
const and = (...parts) => `(${parts.filter(Boolean).join(' && ')})`;
const oneOf = (expr, values) => or(...values.map((v) => `${expr} == '${v}'`));

/* ---------- Staff (admin portal) ---------- */
const OWNER_BY_EMAIL = `(auth.token.email == '${OWNER_EMAIL}' && auth.token.email_verified == true)`;
const STAFF_NODE = `root.child('v3/staff/' + auth.uid)`;
const STAFF_ROLE = `${STAFF_NODE}.child('role').val()`;
const STAFF_ACTIVE = and(`${STAFF_NODE}.exists()`, `${STAFF_NODE}.child('disabled').val() != true`);
const isOwner = and('auth != null', or(OWNER_BY_EMAIL, and(STAFF_ACTIVE, `${STAFF_ROLE} == 'owner'`)));
const isDev = and(
  'auth != null',
  or(OWNER_BY_EMAIL, and(STAFF_ACTIVE, oneOf(STAFF_ROLE, ['owner', 'developer'])))
);
const isStaff = and('auth != null', or(OWNER_BY_EMAIL, STAFF_ACTIVE));
const AUTH_EMAIL_KEY = `auth.token.email.toLowerCase().replace('.', ',')`;

/* ---------- Family members ---------- */
const ME = `root.child('v3/users/' + auth.uid)`;
const MY_FID = `${ME}.child('fid').val()`;
const MY_ROLE = `${ME}.child('role').val()`;
const ME_ACTIVE = and(`${ME}.exists()`, `${ME}.child('disabled').val() != true`);
const famStatus = (fidExpr) => `root.child('v3/families/' + ${fidExpr} + '/meta/status').val()`;
const famCreator = (fidExpr) => `root.child('v3/families/' + ${fidExpr} + '/meta/createdBy').val()`;

/** Signed-in, enabled member of an *active* family identified by fidExpr. */
const inFamily = (fidExpr) =>
  and('auth != null', ME_ACTIVE, `${MY_FID} == ${fidExpr}`, `${famStatus(fidExpr)} == 'active'`);
const familyRole = (fidExpr, roles) => and(inFamily(fidExpr), oneOf(MY_ROLE, roles));
const familyAdminOfOwn = and(
  'auth != null',
  ME_ACTIVE,
  `${MY_ROLE} == 'admin'`,
  `${famStatus(MY_FID)} == 'active'`
);
const EDITORS = ['admin', 'mother', 'member'];

/** Founder of a family that is still pending staff approval. */
const pendingFounderOf = (fidExpr) =>
  and('auth != null', `${famCreator(fidExpr)} == auth.uid`, `${famStatus(fidExpr)} == 'pending'`);

const noSecrets = (node = 'newData') =>
  ['accessCode', 'password', 'salt', 'hash', 'pin', 'key', 'apiKey']
    .map((k) => `!${node}.hasChild('${k}')`)
    .join(' && ');

const str = (child, min, max) =>
  and(
    `newData.child('${child}').isString()`,
    `newData.child('${child}').val().length >= ${min}`,
    `newData.child('${child}').val().length <= ${max}`
  );

/* ---------- Legacy v2 room rules (kept so existing v2 data stays readable for migration) ---------- */
const existing = JSON.parse(fs.readFileSync(rulesPath, 'utf8'));
const v2Rooms = existing.rules?.v2?.rooms;
if (!v2Rooms) throw new Error('Existing v2 room rules not found; refusing to overwrite.');

const v3 = {
  staff: {
    '.read': isStaff,
    $uid: {
      '.read': `auth != null && auth.uid == $uid`,
      '.write': or(
        isOwner,
        and(
          'auth != null',
          'auth.uid == $uid',
          '!data.exists()',
          or(
            and(OWNER_BY_EMAIL, `newData.child('role').val() == 'owner'`),
            and(
              'auth.token.email != null',
              'auth.token.email_verified == true',
              `root.child('v3/staffInvites/' + ${AUTH_EMAIL_KEY} + '/role').val() == newData.child('role').val()`
            )
          )
        )
      ),
      '.validate': and(
        `newData.hasChildren(['role', 'email', 'addedAt'])`,
        oneOf(`newData.child('role').val()`, STAFF_ROLES),
        str('email', 3, 120),
        `newData.child('addedAt').isNumber()`
      ),
    },
  },
  staffInvites: {
    '.read': isStaff,
    $key: {
      '.write': or(
        isOwner,
        and('auth != null', 'auth.token.email != null', `$key == ${AUTH_EMAIL_KEY}`, '!newData.exists()')
      ),
      '.validate': and(
        `newData.hasChildren(['role', 'invitedAt'])`,
        oneOf(`newData.child('role').val()`, STAFF_ROLES)
      ),
    },
  },
  platform: {
    '.read': 'auth != null',
    '.write': isDev,
    ai: {
      providers: {
        $pid: {
          '.validate': and(
            `newData.hasChildren(['name', 'type', 'url', 'model'])`,
            noSecrets(),
            oneOf(`newData.child('type').val()`, ['gemini', 'openai', 'anthropic'])
          ),
        },
      },
    },
  },
  familyIndex: {
    $hash: {
      '.read': true,
      '.write': or(
        isDev,
        and(
          'auth != null',
          '!data.exists()',
          `newData.child('status').val() == 'pending'`,
          `${famCreator(`newData.child('fid').val()`)} == auth.uid`,
          `${famStatus(`newData.child('fid').val()`)} == 'pending'`
        )
      ),
      '.validate': and(
        `newData.hasChildren(['fid', 'status'])`,
        str('fid', 4, 64),
        oneOf(`newData.child('status').val()`, FAMILY_STATUSES)
      ),
    },
  },
  loginIndex: {
    $fid: {
      $memHash: {
        '.read': true,
        '.write': or(
          isStaff,
          familyRole('$fid', ['admin']),
          and('!data.exists()', `${MY_FID} == $fid`, pendingFounderOf('$fid'))
        ),
        '.validate': and(
          `newData.hasChildren(['gen', 'memberId'])`,
          `newData.child('gen').isNumber()`,
          `newData.child('gen').val() >= 1`,
          str('memberId', 2, 80)
        ),
      },
    },
  },
  directory: {
    '.read': isStaff,
    $fid: {
      '.write': or(isDev, and('auth != null', '!data.exists()', `${famCreator('$fid')} == auth.uid`)),
      '.validate': and(
        `newData.hasChildren(['name', 'status', 'createdAt'])`,
        str('name', 2, 50),
        oneOf(`newData.child('status').val()`, FAMILY_STATUSES)
      ),
    },
  },
  users: {
    $uid: {
      '.read': and('auth != null', or('auth.uid == $uid', isStaff)),
      '.write': or(
        isStaff,
        and(
          'auth.uid == $uid',
          '!data.exists()',
          `newData.child('role').val() == 'admin'`,
          pendingFounderOf(`newData.child('fid').val()`)
        ),
        and(
          familyAdminOfOwn,
          'newData.exists()',
          `newData.child('fid').val() == ${MY_FID}`,
          or('!data.exists()', `data.child('fid').val() == ${MY_FID}`)
        ),
        and(familyAdminOfOwn, '!newData.exists()', `data.child('fid').val() == ${MY_FID}`)
      ),
      '.validate': and(
        `newData.hasChildren(['fid', 'memberId', 'role', 'disabled', 'createdAt'])`,
        str('fid', 4, 64),
        str('memberId', 2, 80),
        oneOf(`newData.child('role').val()`, FAMILY_ROLES),
        `newData.child('disabled').isBoolean()`,
        `newData.child('createdAt').isNumber()`,
        noSecrets()
      ),
    },
  },
  families: {
    $fid: {
      '.read': or(isStaff, inFamily('$fid')),
      '.write': isDev,
      meta: {
        '.read': and('auth != null', `${MY_FID} == $fid`),
        '.write': and(
          'auth != null',
          '!data.exists()',
          `newData.child('createdBy').val() == auth.uid`,
          `newData.child('status').val() == 'pending'`,
          `!${ME}.exists()`
        ),
        '.validate': and(
          `newData.hasChildren(['name', 'status', 'createdAt', 'createdBy'])`,
          str('name', 2, 50),
          oneOf(`newData.child('status').val()`, FAMILY_STATUSES),
          `newData.child('createdAt').isNumber()`
        ),
        email: {
          '.write': familyRole('$fid', ['admin']),
          '.validate': `newData.isString() && newData.val().length <= 120`,
        },
        phone: {
          '.write': familyRole('$fid', ['admin']),
          '.validate': `newData.isString() && newData.val().length <= 20`,
        },
      },
      settings: {
        prefs: { '.write': familyRole('$fid', ['admin']) },
        features: {
          $feature: { '.validate': 'newData.isBoolean()' },
        },
      },
      members: {
        $mid: {
          '.write': or(
            isStaff,
            familyRole('$fid', ['admin']),
            and(
              '!data.exists()',
              pendingFounderOf('$fid'),
              `newData.child('uid').val() == auth.uid`,
              `newData.child('role').val() == 'admin'`
            ),
            // Any active member may update gamification points only (tasks / rewards).
            and(
              inFamily('$fid'),
              'data.exists()',
              'newData.exists()',
              `newData.child('role').val() == data.child('role').val()`,
              `newData.child('uid').val() == data.child('uid').val()`,
              `newData.child('name').val() == data.child('name').val()`,
              `newData.child('off').val() == data.child('off').val()`,
              `newData.child('deleted').val() == data.child('deleted').val()`
            )
          ),
          '.validate': and(
            `newData.hasChildren(['name', 'role'])`,
            str('name', 1, 40),
            oneOf(`newData.child('role').val()`, FAMILY_ROLES),
            noSecrets()
          ),
        },
      },
      cats: {
        $cid: {
          '.write': familyRole('$fid', EDITORS),
          '.validate': and(
            `newData.hasChildren(['n', 'updatedAt'])`,
            str('n', 1, 40),
            `newData.child('updatedAt').isNumber()`
          ),
        },
      },
      items: {
        $iid: {
          '.write': familyRole('$fid', EDITORS),
          '.validate': and(
            `newData.hasChildren(['n', 'c', 'updatedAt'])`,
            str('n', 1, 80),
            str('c', 1, 64),
            `newData.child('updatedAt').isNumber()`
          ),
        },
      },
      requests: {
        $reqId: {
          '.write': or(
            familyRole('$fid', EDITORS),
            and(
              familyRole('$fid', ['child']),
              `newData.child('status').val() == 'pending'`,
              or('!data.exists()', `data.child('by').val() == newData.child('by').val()`)
            )
          ),
          '.validate': and(`newData.hasChildren(['n', 'status'])`, str('n', 1, 80)),
        },
      },
      tasks: {
        $taskId: {
          '.write': inFamily('$fid'),
          '.validate': and(`newData.hasChildren(['title', 'updatedAt'])`, str('title', 1, 80)),
        },
      },
      history: {
        $histId: { '.write': familyRole('$fid', EDITORS) },
      },
      log: {
        $logId: {
          '.write': inFamily('$fid'),
          '.validate': and(
            `newData.hasChildren(['at', 'action'])`,
            `newData.child('at').isNumber()`,
            str('action', 1, 60)
          ),
        },
      },
      budget: {
        '.write': familyRole('$fid', ['admin', 'mother']),
        '.validate': `newData.hasChild('monthly') && newData.child('monthly').isNumber() && newData.child('monthly').val() >= 0`,
      },
      aiUsage: {
        $uid: {
          $day: {
            '.write': and(inFamily('$fid'), 'auth.uid == $uid'),
            '.validate': `newData.isNumber() && newData.val() >= 0 && newData.val() <= 500`,
          },
        },
      },
    },
  },
  audit: {
    $scope: {
      '.read': or(isStaff, familyRole('$scope', ['admin'])),
      $auditId: {
        '.write': and(
          '!data.exists()',
          'newData.exists()',
          `newData.child('actorUid').val() == auth.uid`,
          or(isStaff, inFamily('$scope'))
        ),
        '.validate': and(
          `newData.hasChildren(['at', 'actorUid', 'actorType', 'action'])`,
          `newData.child('at').isNumber()`,
          `newData.child('at').val() <= now + 60000`,
          str('action', 1, 80),
          oneOf(`newData.child('actorType').val()`, ['staff', 'family']),
          noSecrets()
        ),
      },
    },
  },
};

const rulesDoc = {
  rules: {
    // Legacy v1 paths: no longer world-writable. Data is preserved and readable by staff for migration.
    rooms: { $legacyRoom: { '.read': isStaff, '.write': false } },
    ai: { $legacyRoom: { '.read': isDev, '.write': false } },
    v2: {
      '.read': isStaff,
      rooms: v2Rooms,
    },
    v3,
  },
};

fs.writeFileSync(rulesPath, `${JSON.stringify(rulesDoc, null, 2)}\n`);
console.log(`✔ Wrote ${path.relative(projectRoot, rulesPath)} (${fs.statSync(rulesPath).size} bytes)`);
