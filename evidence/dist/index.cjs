"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __commonJS = (cb, mod) => function __require() {
  try {
    return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
  } catch (e) {
    throw mod = 0, e;
  }
};
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// ../node_modules/yaml/dist/nodes/identity.js
var require_identity = __commonJS({
  "../node_modules/yaml/dist/nodes/identity.js"(exports2) {
    "use strict";
    var ALIAS = /* @__PURE__ */ Symbol.for("yaml.alias");
    var DOC = /* @__PURE__ */ Symbol.for("yaml.document");
    var MAP = /* @__PURE__ */ Symbol.for("yaml.map");
    var PAIR = /* @__PURE__ */ Symbol.for("yaml.pair");
    var SCALAR = /* @__PURE__ */ Symbol.for("yaml.scalar");
    var SEQ = /* @__PURE__ */ Symbol.for("yaml.seq");
    var NODE_TYPE = /* @__PURE__ */ Symbol.for("yaml.node.type");
    var isAlias = (node) => !!node && typeof node === "object" && node[NODE_TYPE] === ALIAS;
    var isDocument = (node) => !!node && typeof node === "object" && node[NODE_TYPE] === DOC;
    var isMap = (node) => !!node && typeof node === "object" && node[NODE_TYPE] === MAP;
    var isPair = (node) => !!node && typeof node === "object" && node[NODE_TYPE] === PAIR;
    var isScalar = (node) => !!node && typeof node === "object" && node[NODE_TYPE] === SCALAR;
    var isSeq = (node) => !!node && typeof node === "object" && node[NODE_TYPE] === SEQ;
    function isCollection(node) {
      if (node && typeof node === "object")
        switch (node[NODE_TYPE]) {
          case MAP:
          case SEQ:
            return true;
        }
      return false;
    }
    function isNode(node) {
      if (node && typeof node === "object")
        switch (node[NODE_TYPE]) {
          case ALIAS:
          case MAP:
          case SCALAR:
          case SEQ:
            return true;
        }
      return false;
    }
    var hasAnchor = (node) => (isScalar(node) || isCollection(node)) && !!node.anchor;
    exports2.ALIAS = ALIAS;
    exports2.DOC = DOC;
    exports2.MAP = MAP;
    exports2.NODE_TYPE = NODE_TYPE;
    exports2.PAIR = PAIR;
    exports2.SCALAR = SCALAR;
    exports2.SEQ = SEQ;
    exports2.hasAnchor = hasAnchor;
    exports2.isAlias = isAlias;
    exports2.isCollection = isCollection;
    exports2.isDocument = isDocument;
    exports2.isMap = isMap;
    exports2.isNode = isNode;
    exports2.isPair = isPair;
    exports2.isScalar = isScalar;
    exports2.isSeq = isSeq;
  }
});

// ../node_modules/yaml/dist/visit.js
var require_visit = __commonJS({
  "../node_modules/yaml/dist/visit.js"(exports2) {
    "use strict";
    var identity = require_identity();
    var BREAK = /* @__PURE__ */ Symbol("break visit");
    var SKIP = /* @__PURE__ */ Symbol("skip children");
    var REMOVE = /* @__PURE__ */ Symbol("remove node");
    function visit(node, visitor) {
      const visitor_ = initVisitor(visitor);
      if (identity.isDocument(node)) {
        const cd = visit_(null, node.contents, visitor_, Object.freeze([node]));
        if (cd === REMOVE)
          node.contents = null;
      } else
        visit_(null, node, visitor_, Object.freeze([]));
    }
    visit.BREAK = BREAK;
    visit.SKIP = SKIP;
    visit.REMOVE = REMOVE;
    function visit_(key, node, visitor, path) {
      const ctrl = callVisitor(key, node, visitor, path);
      if (identity.isNode(ctrl) || identity.isPair(ctrl)) {
        replaceNode(key, path, ctrl);
        return visit_(key, ctrl, visitor, path);
      }
      if (typeof ctrl !== "symbol") {
        if (identity.isCollection(node)) {
          path = Object.freeze(path.concat(node));
          for (let i = 0; i < node.items.length; ++i) {
            const ci = visit_(i, node.items[i], visitor, path);
            if (typeof ci === "number")
              i = ci - 1;
            else if (ci === BREAK)
              return BREAK;
            else if (ci === REMOVE) {
              node.items.splice(i, 1);
              i -= 1;
            }
          }
        } else if (identity.isPair(node)) {
          path = Object.freeze(path.concat(node));
          const ck = visit_("key", node.key, visitor, path);
          if (ck === BREAK)
            return BREAK;
          else if (ck === REMOVE)
            node.key = null;
          const cv = visit_("value", node.value, visitor, path);
          if (cv === BREAK)
            return BREAK;
          else if (cv === REMOVE)
            node.value = null;
        }
      }
      return ctrl;
    }
    async function visitAsync(node, visitor) {
      const visitor_ = initVisitor(visitor);
      if (identity.isDocument(node)) {
        const cd = await visitAsync_(null, node.contents, visitor_, Object.freeze([node]));
        if (cd === REMOVE)
          node.contents = null;
      } else
        await visitAsync_(null, node, visitor_, Object.freeze([]));
    }
    visitAsync.BREAK = BREAK;
    visitAsync.SKIP = SKIP;
    visitAsync.REMOVE = REMOVE;
    async function visitAsync_(key, node, visitor, path) {
      const ctrl = await callVisitor(key, node, visitor, path);
      if (identity.isNode(ctrl) || identity.isPair(ctrl)) {
        replaceNode(key, path, ctrl);
        return visitAsync_(key, ctrl, visitor, path);
      }
      if (typeof ctrl !== "symbol") {
        if (identity.isCollection(node)) {
          path = Object.freeze(path.concat(node));
          for (let i = 0; i < node.items.length; ++i) {
            const ci = await visitAsync_(i, node.items[i], visitor, path);
            if (typeof ci === "number")
              i = ci - 1;
            else if (ci === BREAK)
              return BREAK;
            else if (ci === REMOVE) {
              node.items.splice(i, 1);
              i -= 1;
            }
          }
        } else if (identity.isPair(node)) {
          path = Object.freeze(path.concat(node));
          const ck = await visitAsync_("key", node.key, visitor, path);
          if (ck === BREAK)
            return BREAK;
          else if (ck === REMOVE)
            node.key = null;
          const cv = await visitAsync_("value", node.value, visitor, path);
          if (cv === BREAK)
            return BREAK;
          else if (cv === REMOVE)
            node.value = null;
        }
      }
      return ctrl;
    }
    function initVisitor(visitor) {
      if (typeof visitor === "object" && (visitor.Collection || visitor.Node || visitor.Value)) {
        return Object.assign({
          Alias: visitor.Node,
          Map: visitor.Node,
          Scalar: visitor.Node,
          Seq: visitor.Node
        }, visitor.Value && {
          Map: visitor.Value,
          Scalar: visitor.Value,
          Seq: visitor.Value
        }, visitor.Collection && {
          Map: visitor.Collection,
          Seq: visitor.Collection
        }, visitor);
      }
      return visitor;
    }
    function callVisitor(key, node, visitor, path) {
      if (typeof visitor === "function")
        return visitor(key, node, path);
      if (identity.isMap(node))
        return visitor.Map?.(key, node, path);
      if (identity.isSeq(node))
        return visitor.Seq?.(key, node, path);
      if (identity.isPair(node))
        return visitor.Pair?.(key, node, path);
      if (identity.isScalar(node))
        return visitor.Scalar?.(key, node, path);
      if (identity.isAlias(node))
        return visitor.Alias?.(key, node, path);
      return void 0;
    }
    function replaceNode(key, path, node) {
      const parent = path[path.length - 1];
      if (identity.isCollection(parent)) {
        parent.items[key] = node;
      } else if (identity.isPair(parent)) {
        if (key === "key")
          parent.key = node;
        else
          parent.value = node;
      } else if (identity.isDocument(parent)) {
        parent.contents = node;
      } else {
        const pt = identity.isAlias(parent) ? "alias" : "scalar";
        throw new Error(`Cannot replace node with ${pt} parent`);
      }
    }
    exports2.visit = visit;
    exports2.visitAsync = visitAsync;
  }
});

// ../node_modules/yaml/dist/doc/directives.js
var require_directives = __commonJS({
  "../node_modules/yaml/dist/doc/directives.js"(exports2) {
    "use strict";
    var identity = require_identity();
    var visit = require_visit();
    var escapeChars = {
      "!": "%21",
      ",": "%2C",
      "[": "%5B",
      "]": "%5D",
      "{": "%7B",
      "}": "%7D"
    };
    var escapeTagName = (tn) => tn.replace(/[!,[\]{}]/g, (ch) => escapeChars[ch]);
    var Directives = class _Directives {
      constructor(yaml, tags) {
        this.docStart = null;
        this.docEnd = false;
        this.yaml = Object.assign({}, _Directives.defaultYaml, yaml);
        this.tags = Object.assign({}, _Directives.defaultTags, tags);
      }
      clone() {
        const copy = new _Directives(this.yaml, this.tags);
        copy.docStart = this.docStart;
        return copy;
      }
      /**
       * During parsing, get a Directives instance for the current document and
       * update the stream state according to the current version's spec.
       */
      atDocument() {
        const res = new _Directives(this.yaml, this.tags);
        switch (this.yaml.version) {
          case "1.1":
            this.atNextDocument = true;
            break;
          case "1.2":
            this.atNextDocument = false;
            this.yaml = {
              explicit: _Directives.defaultYaml.explicit,
              version: "1.2"
            };
            this.tags = Object.assign({}, _Directives.defaultTags);
            break;
        }
        return res;
      }
      /**
       * @param onError - May be called even if the action was successful
       * @returns `true` on success
       */
      add(line, onError) {
        if (this.atNextDocument) {
          this.yaml = { explicit: _Directives.defaultYaml.explicit, version: "1.1" };
          this.tags = Object.assign({}, _Directives.defaultTags);
          this.atNextDocument = false;
        }
        const parts = line.trim().split(/[ \t]+/);
        const name = parts.shift();
        switch (name) {
          case "%TAG": {
            if (parts.length !== 2) {
              onError(0, "%TAG directive should contain exactly two parts");
              if (parts.length < 2)
                return false;
            }
            const [handle, prefix] = parts;
            this.tags[handle] = prefix;
            return true;
          }
          case "%YAML": {
            this.yaml.explicit = true;
            if (parts.length !== 1) {
              onError(0, "%YAML directive should contain exactly one part");
              return false;
            }
            const [version] = parts;
            if (version === "1.1" || version === "1.2") {
              this.yaml.version = version;
              return true;
            } else {
              const isValid = /^\d+\.\d+$/.test(version);
              onError(6, `Unsupported YAML version ${version}`, isValid);
              return false;
            }
          }
          default:
            onError(0, `Unknown directive ${name}`, true);
            return false;
        }
      }
      /**
       * Resolves a tag, matching handles to those defined in %TAG directives.
       *
       * @returns Resolved tag, which may also be the non-specific tag `'!'` or a
       *   `'!local'` tag, or `null` if unresolvable.
       */
      tagName(source, onError) {
        if (source === "!")
          return "!";
        if (source[0] !== "!") {
          onError(`Not a valid tag: ${source}`);
          return null;
        }
        if (source[1] === "<") {
          const verbatim = source.slice(2, -1);
          if (verbatim === "!" || verbatim === "!!") {
            onError(`Verbatim tags aren't resolved, so ${source} is invalid.`);
            return null;
          }
          if (source[source.length - 1] !== ">")
            onError("Verbatim tags must end with a >");
          return verbatim;
        }
        const [, handle, suffix] = source.match(/^(.*!)([^!]*)$/s);
        if (!suffix)
          onError(`The ${source} tag has no suffix`);
        const prefix = this.tags[handle];
        if (prefix) {
          try {
            return prefix + decodeURIComponent(suffix);
          } catch (error) {
            onError(String(error));
            return null;
          }
        }
        if (handle === "!")
          return source;
        onError(`Could not resolve tag: ${source}`);
        return null;
      }
      /**
       * Given a fully resolved tag, returns its printable string form,
       * taking into account current tag prefixes and defaults.
       */
      tagString(tag) {
        for (const [handle, prefix] of Object.entries(this.tags)) {
          if (tag.startsWith(prefix))
            return handle + escapeTagName(tag.substring(prefix.length));
        }
        return tag[0] === "!" ? tag : `!<${tag}>`;
      }
      toString(doc) {
        const lines = this.yaml.explicit ? [`%YAML ${this.yaml.version || "1.2"}`] : [];
        const tagEntries = Object.entries(this.tags);
        let tagNames;
        if (doc && tagEntries.length > 0 && identity.isNode(doc.contents)) {
          const tags = {};
          visit.visit(doc.contents, (_key, node) => {
            if (identity.isNode(node) && node.tag)
              tags[node.tag] = true;
          });
          tagNames = Object.keys(tags);
        } else
          tagNames = [];
        for (const [handle, prefix] of tagEntries) {
          if (handle === "!!" && prefix === "tag:yaml.org,2002:")
            continue;
          if (!doc || tagNames.some((tn) => tn.startsWith(prefix)))
            lines.push(`%TAG ${handle} ${prefix}`);
        }
        return lines.join("\n");
      }
    };
    Directives.defaultYaml = { explicit: false, version: "1.2" };
    Directives.defaultTags = { "!!": "tag:yaml.org,2002:" };
    exports2.Directives = Directives;
  }
});

// ../node_modules/yaml/dist/doc/anchors.js
var require_anchors = __commonJS({
  "../node_modules/yaml/dist/doc/anchors.js"(exports2) {
    "use strict";
    var identity = require_identity();
    var visit = require_visit();
    function anchorIsValid(anchor) {
      if (/[\x00-\x19\s,[\]{}]/.test(anchor)) {
        const sa = JSON.stringify(anchor);
        const msg = `Anchor must not contain whitespace or control characters: ${sa}`;
        throw new Error(msg);
      }
      return true;
    }
    function anchorNames(root) {
      const anchors = /* @__PURE__ */ new Set();
      visit.visit(root, {
        Value(_key, node) {
          if (node.anchor)
            anchors.add(node.anchor);
        }
      });
      return anchors;
    }
    function findNewAnchor(prefix, exclude) {
      for (let i = 1; true; ++i) {
        const name = `${prefix}${i}`;
        if (!exclude.has(name))
          return name;
      }
    }
    function createNodeAnchors(doc, prefix) {
      const aliasObjects = [];
      const sourceObjects = /* @__PURE__ */ new Map();
      let prevAnchors = null;
      return {
        onAnchor: (source) => {
          aliasObjects.push(source);
          prevAnchors ?? (prevAnchors = anchorNames(doc));
          const anchor = findNewAnchor(prefix, prevAnchors);
          prevAnchors.add(anchor);
          return anchor;
        },
        /**
         * With circular references, the source node is only resolved after all
         * of its child nodes are. This is why anchors are set only after all of
         * the nodes have been created.
         */
        setAnchors: () => {
          for (const source of aliasObjects) {
            const ref = sourceObjects.get(source);
            if (typeof ref === "object" && ref.anchor && (identity.isScalar(ref.node) || identity.isCollection(ref.node))) {
              ref.node.anchor = ref.anchor;
            } else {
              const error = new Error("Failed to resolve repeated object (this should not happen)");
              error.source = source;
              throw error;
            }
          }
        },
        sourceObjects
      };
    }
    exports2.anchorIsValid = anchorIsValid;
    exports2.anchorNames = anchorNames;
    exports2.createNodeAnchors = createNodeAnchors;
    exports2.findNewAnchor = findNewAnchor;
  }
});

// ../node_modules/yaml/dist/doc/applyReviver.js
var require_applyReviver = __commonJS({
  "../node_modules/yaml/dist/doc/applyReviver.js"(exports2) {
    "use strict";
    function applyReviver(reviver, obj, key, val) {
      if (val && typeof val === "object") {
        if (Array.isArray(val)) {
          for (let i = 0, len = val.length; i < len; ++i) {
            const v0 = val[i];
            const v1 = applyReviver(reviver, val, String(i), v0);
            if (v1 === void 0)
              delete val[i];
            else if (v1 !== v0)
              val[i] = v1;
          }
        } else if (val instanceof Map) {
          for (const k of Array.from(val.keys())) {
            const v0 = val.get(k);
            const v1 = applyReviver(reviver, val, k, v0);
            if (v1 === void 0)
              val.delete(k);
            else if (v1 !== v0)
              val.set(k, v1);
          }
        } else if (val instanceof Set) {
          for (const v0 of Array.from(val)) {
            const v1 = applyReviver(reviver, val, v0, v0);
            if (v1 === void 0)
              val.delete(v0);
            else if (v1 !== v0) {
              val.delete(v0);
              val.add(v1);
            }
          }
        } else {
          for (const [k, v0] of Object.entries(val)) {
            const v1 = applyReviver(reviver, val, k, v0);
            if (v1 === void 0)
              delete val[k];
            else if (v1 !== v0)
              val[k] = v1;
          }
        }
      }
      return reviver.call(obj, key, val);
    }
    exports2.applyReviver = applyReviver;
  }
});

// ../node_modules/yaml/dist/nodes/toJS.js
var require_toJS = __commonJS({
  "../node_modules/yaml/dist/nodes/toJS.js"(exports2) {
    "use strict";
    var identity = require_identity();
    function toJS(value, arg, ctx) {
      if (Array.isArray(value))
        return value.map((v, i) => toJS(v, String(i), ctx));
      if (value && typeof value.toJSON === "function") {
        if (!ctx || !identity.hasAnchor(value))
          return value.toJSON(arg, ctx);
        const data = { aliasCount: 0, count: 1, res: void 0 };
        ctx.anchors.set(value, data);
        ctx.onCreate = (res2) => {
          data.res = res2;
          delete ctx.onCreate;
        };
        const res = value.toJSON(arg, ctx);
        if (ctx.onCreate)
          ctx.onCreate(res);
        return res;
      }
      if (typeof value === "bigint" && !ctx?.keep)
        return Number(value);
      return value;
    }
    exports2.toJS = toJS;
  }
});

// ../node_modules/yaml/dist/nodes/Node.js
var require_Node = __commonJS({
  "../node_modules/yaml/dist/nodes/Node.js"(exports2) {
    "use strict";
    var applyReviver = require_applyReviver();
    var identity = require_identity();
    var toJS = require_toJS();
    var NodeBase = class {
      constructor(type) {
        Object.defineProperty(this, identity.NODE_TYPE, { value: type });
      }
      /** Create a copy of this node.  */
      clone() {
        const copy = Object.create(Object.getPrototypeOf(this), Object.getOwnPropertyDescriptors(this));
        if (this.range)
          copy.range = this.range.slice();
        return copy;
      }
      /** A plain JavaScript representation of this node. */
      toJS(doc, { mapAsMap, maxAliasCount, onAnchor, reviver } = {}) {
        if (!identity.isDocument(doc))
          throw new TypeError("A document argument is required");
        const ctx = {
          anchors: /* @__PURE__ */ new Map(),
          doc,
          keep: true,
          mapAsMap: mapAsMap === true,
          mapKeyWarned: false,
          maxAliasCount: typeof maxAliasCount === "number" ? maxAliasCount : 100
        };
        const res = toJS.toJS(this, "", ctx);
        if (typeof onAnchor === "function")
          for (const { count, res: res2 } of ctx.anchors.values())
            onAnchor(res2, count);
        return typeof reviver === "function" ? applyReviver.applyReviver(reviver, { "": res }, "", res) : res;
      }
    };
    exports2.NodeBase = NodeBase;
  }
});

// ../node_modules/yaml/dist/nodes/Alias.js
var require_Alias = __commonJS({
  "../node_modules/yaml/dist/nodes/Alias.js"(exports2) {
    "use strict";
    var anchors = require_anchors();
    var visit = require_visit();
    var identity = require_identity();
    var Node = require_Node();
    var toJS = require_toJS();
    var Alias = class extends Node.NodeBase {
      constructor(source) {
        super(identity.ALIAS);
        this.source = source;
        Object.defineProperty(this, "tag", {
          set() {
            throw new Error("Alias nodes cannot have tags");
          }
        });
      }
      /**
       * Resolve the value of this alias within `doc`, finding the last
       * instance of the `source` anchor before this node.
       */
      resolve(doc, ctx) {
        if (ctx?.maxAliasCount === 0)
          throw new ReferenceError("Alias resolution is disabled");
        let nodes;
        if (ctx?.aliasResolveCache) {
          nodes = ctx.aliasResolveCache;
        } else {
          nodes = [];
          visit.visit(doc, {
            Node: (_key, node) => {
              if (identity.isAlias(node) || identity.hasAnchor(node))
                nodes.push(node);
            }
          });
          if (ctx)
            ctx.aliasResolveCache = nodes;
        }
        let found = void 0;
        for (const node of nodes) {
          if (node === this)
            break;
          if (node.anchor === this.source)
            found = node;
        }
        if (found && ctx) {
          const { anchors: anchors2, doc: doc2, maxAliasCount } = ctx;
          let data = anchors2.get(found);
          if (!data) {
            toJS.toJS(found, null, ctx);
            data = anchors2.get(found);
          }
          if (data?.res === void 0) {
            const msg = "This should not happen: Alias anchor was not resolved?";
            throw new ReferenceError(msg);
          }
          if (maxAliasCount >= 0) {
            data.count += 1;
            if (data.aliasCount === 0)
              data.aliasCount = getAliasCount(doc2, found, anchors2);
            if (data.count * data.aliasCount > maxAliasCount) {
              const msg = "Excessive alias count indicates a resource exhaustion attack";
              throw new ReferenceError(msg);
            }
          }
        }
        return found;
      }
      toJSON(_arg, ctx) {
        if (!ctx)
          return { source: this.source };
        const source = this.resolve(ctx.doc, ctx);
        if (!source) {
          const msg = `Unresolved alias (the anchor must be set before the alias): ${this.source}`;
          throw new ReferenceError(msg);
        }
        return ctx.anchors.get(source).res;
      }
      toString(ctx, _onComment, _onChompKeep) {
        const src = `*${this.source}`;
        if (ctx) {
          anchors.anchorIsValid(this.source);
          if (ctx.options.verifyAliasOrder && !ctx.anchors.has(this.source)) {
            const msg = `Unresolved alias (the anchor must be set before the alias): ${this.source}`;
            throw new Error(msg);
          }
          if (ctx.implicitKey)
            return `${src} `;
        }
        return src;
      }
    };
    function getAliasCount(doc, node, anchors2) {
      if (identity.isAlias(node)) {
        const source = node.resolve(doc);
        const anchor = anchors2 && source && anchors2.get(source);
        return anchor ? anchor.count * anchor.aliasCount : 0;
      } else if (identity.isCollection(node)) {
        let count = 0;
        for (const item of node.items) {
          const c = getAliasCount(doc, item, anchors2);
          if (c > count)
            count = c;
        }
        return count;
      } else if (identity.isPair(node)) {
        const kc = getAliasCount(doc, node.key, anchors2);
        const vc = getAliasCount(doc, node.value, anchors2);
        return Math.max(kc, vc);
      }
      return 1;
    }
    exports2.Alias = Alias;
  }
});

// ../node_modules/yaml/dist/nodes/Scalar.js
var require_Scalar = __commonJS({
  "../node_modules/yaml/dist/nodes/Scalar.js"(exports2) {
    "use strict";
    var identity = require_identity();
    var Node = require_Node();
    var toJS = require_toJS();
    var isScalarValue = (value) => !value || typeof value !== "function" && typeof value !== "object";
    var Scalar = class extends Node.NodeBase {
      constructor(value) {
        super(identity.SCALAR);
        this.value = value;
      }
      toJSON(arg, ctx) {
        return ctx?.keep ? this.value : toJS.toJS(this.value, arg, ctx);
      }
      toString() {
        return String(this.value);
      }
    };
    Scalar.BLOCK_FOLDED = "BLOCK_FOLDED";
    Scalar.BLOCK_LITERAL = "BLOCK_LITERAL";
    Scalar.PLAIN = "PLAIN";
    Scalar.QUOTE_DOUBLE = "QUOTE_DOUBLE";
    Scalar.QUOTE_SINGLE = "QUOTE_SINGLE";
    exports2.Scalar = Scalar;
    exports2.isScalarValue = isScalarValue;
  }
});

// ../node_modules/yaml/dist/doc/createNode.js
var require_createNode = __commonJS({
  "../node_modules/yaml/dist/doc/createNode.js"(exports2) {
    "use strict";
    var Alias = require_Alias();
    var identity = require_identity();
    var Scalar = require_Scalar();
    var defaultTagPrefix = "tag:yaml.org,2002:";
    function findTagObject(value, tagName, tags) {
      if (tagName) {
        const match = tags.filter((t) => t.tag === tagName);
        const tagObj = match.find((t) => !t.format) ?? match[0];
        if (!tagObj)
          throw new Error(`Tag ${tagName} not found`);
        return tagObj;
      }
      return tags.find((t) => t.identify?.(value) && !t.format);
    }
    function createNode(value, tagName, ctx) {
      if (identity.isDocument(value))
        value = value.contents;
      if (identity.isNode(value))
        return value;
      if (identity.isPair(value)) {
        const map = ctx.schema[identity.MAP].createNode?.(ctx.schema, null, ctx);
        map.items.push(value);
        return map;
      }
      if (value instanceof String || value instanceof Number || value instanceof Boolean || typeof BigInt !== "undefined" && value instanceof BigInt) {
        value = value.valueOf();
      }
      const { aliasDuplicateObjects, onAnchor, onTagObj, schema, sourceObjects } = ctx;
      let ref = void 0;
      if (aliasDuplicateObjects && value && typeof value === "object") {
        ref = sourceObjects.get(value);
        if (ref) {
          ref.anchor ?? (ref.anchor = onAnchor(value));
          return new Alias.Alias(ref.anchor);
        } else {
          ref = { anchor: null, node: null };
          sourceObjects.set(value, ref);
        }
      }
      if (tagName?.startsWith("!!"))
        tagName = defaultTagPrefix + tagName.slice(2);
      let tagObj = findTagObject(value, tagName, schema.tags);
      if (!tagObj) {
        if (value && typeof value.toJSON === "function") {
          value = value.toJSON();
        }
        if (!value || typeof value !== "object") {
          const node2 = new Scalar.Scalar(value);
          if (ref)
            ref.node = node2;
          return node2;
        }
        tagObj = value instanceof Map ? schema[identity.MAP] : Symbol.iterator in Object(value) ? schema[identity.SEQ] : schema[identity.MAP];
      }
      if (onTagObj) {
        onTagObj(tagObj);
        delete ctx.onTagObj;
      }
      const node = tagObj?.createNode ? tagObj.createNode(ctx.schema, value, ctx) : typeof tagObj?.nodeClass?.from === "function" ? tagObj.nodeClass.from(ctx.schema, value, ctx) : new Scalar.Scalar(value);
      if (tagName)
        node.tag = tagName;
      else if (!tagObj.default)
        node.tag = tagObj.tag;
      if (ref)
        ref.node = node;
      return node;
    }
    exports2.createNode = createNode;
  }
});

// ../node_modules/yaml/dist/nodes/Collection.js
var require_Collection = __commonJS({
  "../node_modules/yaml/dist/nodes/Collection.js"(exports2) {
    "use strict";
    var createNode = require_createNode();
    var identity = require_identity();
    var Node = require_Node();
    function collectionFromPath(schema, path, value) {
      let v = value;
      for (let i = path.length - 1; i >= 0; --i) {
        const k = path[i];
        if (typeof k === "number" && Number.isInteger(k) && k >= 0) {
          const a = [];
          a[k] = v;
          v = a;
        } else {
          v = /* @__PURE__ */ new Map([[k, v]]);
        }
      }
      return createNode.createNode(v, void 0, {
        aliasDuplicateObjects: false,
        keepUndefined: false,
        onAnchor: () => {
          throw new Error("This should not happen, please report a bug.");
        },
        schema,
        sourceObjects: /* @__PURE__ */ new Map()
      });
    }
    var isEmptyPath = (path) => path == null || typeof path === "object" && !!path[Symbol.iterator]().next().done;
    var Collection = class extends Node.NodeBase {
      constructor(type, schema) {
        super(type);
        Object.defineProperty(this, "schema", {
          value: schema,
          configurable: true,
          enumerable: false,
          writable: true
        });
      }
      /**
       * Create a copy of this collection.
       *
       * @param schema - If defined, overwrites the original's schema
       */
      clone(schema) {
        const copy = Object.create(Object.getPrototypeOf(this), Object.getOwnPropertyDescriptors(this));
        if (schema)
          copy.schema = schema;
        copy.items = copy.items.map((it) => identity.isNode(it) || identity.isPair(it) ? it.clone(schema) : it);
        if (this.range)
          copy.range = this.range.slice();
        return copy;
      }
      /**
       * Adds a value to the collection. For `!!map` and `!!omap` the value must
       * be a Pair instance or a `{ key, value }` object, which may not have a key
       * that already exists in the map.
       */
      addIn(path, value) {
        if (isEmptyPath(path))
          this.add(value);
        else {
          const [key, ...rest] = path;
          const node = this.get(key, true);
          if (identity.isCollection(node))
            node.addIn(rest, value);
          else if (node === void 0 && this.schema)
            this.set(key, collectionFromPath(this.schema, rest, value));
          else
            throw new Error(`Expected YAML collection at ${key}. Remaining path: ${rest}`);
        }
      }
      /**
       * Removes a value from the collection.
       * @returns `true` if the item was found and removed.
       */
      deleteIn(path) {
        const [key, ...rest] = path;
        if (rest.length === 0)
          return this.delete(key);
        const node = this.get(key, true);
        if (identity.isCollection(node))
          return node.deleteIn(rest);
        else
          throw new Error(`Expected YAML collection at ${key}. Remaining path: ${rest}`);
      }
      /**
       * Returns item at `key`, or `undefined` if not found. By default unwraps
       * scalar values from their surrounding node; to disable set `keepScalar` to
       * `true` (collections are always returned intact).
       */
      getIn(path, keepScalar) {
        const [key, ...rest] = path;
        const node = this.get(key, true);
        if (rest.length === 0)
          return !keepScalar && identity.isScalar(node) ? node.value : node;
        else
          return identity.isCollection(node) ? node.getIn(rest, keepScalar) : void 0;
      }
      hasAllNullValues(allowScalar) {
        return this.items.every((node) => {
          if (!identity.isPair(node))
            return false;
          const n = node.value;
          return n == null || allowScalar && identity.isScalar(n) && n.value == null && !n.commentBefore && !n.comment && !n.tag;
        });
      }
      /**
       * Checks if the collection includes a value with the key `key`.
       */
      hasIn(path) {
        const [key, ...rest] = path;
        if (rest.length === 0)
          return this.has(key);
        const node = this.get(key, true);
        return identity.isCollection(node) ? node.hasIn(rest) : false;
      }
      /**
       * Sets a value in this collection. For `!!set`, `value` needs to be a
       * boolean to add/remove the item from the set.
       */
      setIn(path, value) {
        const [key, ...rest] = path;
        if (rest.length === 0) {
          this.set(key, value);
        } else {
          const node = this.get(key, true);
          if (identity.isCollection(node))
            node.setIn(rest, value);
          else if (node === void 0 && this.schema)
            this.set(key, collectionFromPath(this.schema, rest, value));
          else
            throw new Error(`Expected YAML collection at ${key}. Remaining path: ${rest}`);
        }
      }
    };
    exports2.Collection = Collection;
    exports2.collectionFromPath = collectionFromPath;
    exports2.isEmptyPath = isEmptyPath;
  }
});

// ../node_modules/yaml/dist/stringify/stringifyComment.js
var require_stringifyComment = __commonJS({
  "../node_modules/yaml/dist/stringify/stringifyComment.js"(exports2) {
    "use strict";
    var stringifyComment = (str) => str.replace(/^(?!$)(?: $)?/gm, "#");
    function indentComment(comment, indent) {
      if (/^\n+$/.test(comment))
        return comment.substring(1);
      return indent ? comment.replace(/^(?! *$)/gm, indent) : comment;
    }
    var lineComment = (str, indent, comment) => str.endsWith("\n") ? indentComment(comment, indent) : comment.includes("\n") ? "\n" + indentComment(comment, indent) : (str.endsWith(" ") ? "" : " ") + comment;
    exports2.indentComment = indentComment;
    exports2.lineComment = lineComment;
    exports2.stringifyComment = stringifyComment;
  }
});

// ../node_modules/yaml/dist/stringify/foldFlowLines.js
var require_foldFlowLines = __commonJS({
  "../node_modules/yaml/dist/stringify/foldFlowLines.js"(exports2) {
    "use strict";
    var FOLD_FLOW = "flow";
    var FOLD_BLOCK = "block";
    var FOLD_QUOTED = "quoted";
    function foldFlowLines(text, indent, mode = "flow", { indentAtStart, lineWidth = 80, minContentWidth = 20, onFold, onOverflow } = {}) {
      if (!lineWidth || lineWidth < 0)
        return text;
      if (lineWidth < minContentWidth)
        minContentWidth = 0;
      const endStep = Math.max(1 + minContentWidth, 1 + lineWidth - indent.length);
      if (text.length <= endStep)
        return text;
      const folds = [];
      const escapedFolds = {};
      let end = lineWidth - indent.length;
      if (typeof indentAtStart === "number") {
        if (indentAtStart > lineWidth - Math.max(2, minContentWidth))
          folds.push(0);
        else
          end = lineWidth - indentAtStart;
      }
      let split = void 0;
      let prev = void 0;
      let overflow = false;
      let i = -1;
      let escStart = -1;
      let escEnd = -1;
      if (mode === FOLD_BLOCK) {
        i = consumeMoreIndentedLines(text, i, indent.length);
        if (i !== -1)
          end = i + endStep;
      }
      for (let ch; ch = text[i += 1]; ) {
        if (mode === FOLD_QUOTED && ch === "\\") {
          escStart = i;
          switch (text[i + 1]) {
            case "x":
              i += 3;
              break;
            case "u":
              i += 5;
              break;
            case "U":
              i += 9;
              break;
            default:
              i += 1;
          }
          escEnd = i;
        }
        if (ch === "\n") {
          if (mode === FOLD_BLOCK)
            i = consumeMoreIndentedLines(text, i, indent.length);
          end = i + indent.length + endStep;
          split = void 0;
        } else {
          if (ch === " " && prev && prev !== " " && prev !== "\n" && prev !== "	") {
            const next = text[i + 1];
            if (next && next !== " " && next !== "\n" && next !== "	")
              split = i;
          }
          if (i >= end) {
            if (split) {
              folds.push(split);
              end = split + endStep;
              split = void 0;
            } else if (mode === FOLD_QUOTED) {
              while (prev === " " || prev === "	") {
                prev = ch;
                ch = text[i += 1];
                overflow = true;
              }
              const j = i > escEnd + 1 ? i - 2 : escStart - 1;
              if (escapedFolds[j])
                return text;
              folds.push(j);
              escapedFolds[j] = true;
              end = j + endStep;
              split = void 0;
            } else {
              overflow = true;
            }
          }
        }
        prev = ch;
      }
      if (overflow && onOverflow)
        onOverflow();
      if (folds.length === 0)
        return text;
      if (onFold)
        onFold();
      let res = text.slice(0, folds[0]);
      for (let i2 = 0; i2 < folds.length; ++i2) {
        const fold = folds[i2];
        const end2 = folds[i2 + 1] || text.length;
        if (fold === 0)
          res = `
${indent}${text.slice(0, end2)}`;
        else {
          if (mode === FOLD_QUOTED && escapedFolds[fold])
            res += `${text[fold]}\\`;
          res += `
${indent}${text.slice(fold + 1, end2)}`;
        }
      }
      return res;
    }
    function consumeMoreIndentedLines(text, i, indent) {
      let end = i;
      let start = i + 1;
      let ch = text[start];
      while (ch === " " || ch === "	") {
        if (i < start + indent) {
          ch = text[++i];
        } else {
          do {
            ch = text[++i];
          } while (ch && ch !== "\n");
          end = i;
          start = i + 1;
          ch = text[start];
        }
      }
      return end;
    }
    exports2.FOLD_BLOCK = FOLD_BLOCK;
    exports2.FOLD_FLOW = FOLD_FLOW;
    exports2.FOLD_QUOTED = FOLD_QUOTED;
    exports2.foldFlowLines = foldFlowLines;
  }
});

// ../node_modules/yaml/dist/stringify/stringifyString.js
var require_stringifyString = __commonJS({
  "../node_modules/yaml/dist/stringify/stringifyString.js"(exports2) {
    "use strict";
    var Scalar = require_Scalar();
    var foldFlowLines = require_foldFlowLines();
    var getFoldOptions = (ctx, isBlock) => ({
      indentAtStart: isBlock ? ctx.indent.length : ctx.indentAtStart,
      lineWidth: ctx.options.lineWidth,
      minContentWidth: ctx.options.minContentWidth
    });
    var containsDocumentMarker = (str) => /^(%|---|\.\.\.)/m.test(str);
    function lineLengthOverLimit(str, lineWidth, indentLength) {
      if (!lineWidth || lineWidth < 0)
        return false;
      const limit = lineWidth - indentLength;
      const strLen = str.length;
      if (strLen <= limit)
        return false;
      for (let i = 0, start = 0; i < strLen; ++i) {
        if (str[i] === "\n") {
          if (i - start > limit)
            return true;
          start = i + 1;
          if (strLen - start <= limit)
            return false;
        }
      }
      return true;
    }
    function doubleQuotedString(value, ctx) {
      const json = JSON.stringify(value);
      if (ctx.options.doubleQuotedAsJSON)
        return json;
      const { implicitKey } = ctx;
      const minMultiLineLength = ctx.options.doubleQuotedMinMultiLineLength;
      const indent = ctx.indent || (containsDocumentMarker(value) ? "  " : "");
      let str = "";
      let start = 0;
      for (let i = 0, ch = json[i]; ch; ch = json[++i]) {
        if (ch === " " && json[i + 1] === "\\" && json[i + 2] === "n") {
          str += json.slice(start, i) + "\\ ";
          i += 1;
          start = i;
          ch = "\\";
        }
        if (ch === "\\")
          switch (json[i + 1]) {
            case "u":
              {
                str += json.slice(start, i);
                const code = json.substr(i + 2, 4);
                switch (code) {
                  case "0000":
                    str += "\\0";
                    break;
                  case "0007":
                    str += "\\a";
                    break;
                  case "000b":
                    str += "\\v";
                    break;
                  case "001b":
                    str += "\\e";
                    break;
                  case "0085":
                    str += "\\N";
                    break;
                  case "00a0":
                    str += "\\_";
                    break;
                  case "2028":
                    str += "\\L";
                    break;
                  case "2029":
                    str += "\\P";
                    break;
                  default:
                    if (code.substr(0, 2) === "00")
                      str += "\\x" + code.substr(2);
                    else
                      str += json.substr(i, 6);
                }
                i += 5;
                start = i + 1;
              }
              break;
            case "n":
              if (implicitKey || json[i + 2] === '"' || json.length < minMultiLineLength) {
                i += 1;
              } else {
                str += json.slice(start, i) + "\n\n";
                while (json[i + 2] === "\\" && json[i + 3] === "n" && json[i + 4] !== '"') {
                  str += "\n";
                  i += 2;
                }
                str += indent;
                if (json[i + 2] === " ")
                  str += "\\";
                i += 1;
                start = i + 1;
              }
              break;
            default:
              i += 1;
          }
      }
      str = start ? str + json.slice(start) : json;
      return implicitKey ? str : foldFlowLines.foldFlowLines(str, indent, foldFlowLines.FOLD_QUOTED, getFoldOptions(ctx, false));
    }
    function singleQuotedString(value, ctx) {
      if (ctx.options.singleQuote === false || ctx.implicitKey && value.includes("\n") || /[ \t]\n|\n[ \t]/.test(value))
        return doubleQuotedString(value, ctx);
      const indent = ctx.indent || (containsDocumentMarker(value) ? "  " : "");
      const res = "'" + value.replace(/'/g, "''").replace(/\n+/g, `$&
${indent}`) + "'";
      return ctx.implicitKey ? res : foldFlowLines.foldFlowLines(res, indent, foldFlowLines.FOLD_FLOW, getFoldOptions(ctx, false));
    }
    function quotedString(value, ctx) {
      const { singleQuote } = ctx.options;
      let qs;
      if (singleQuote === false)
        qs = doubleQuotedString;
      else {
        const hasDouble = value.includes('"');
        const hasSingle = value.includes("'");
        if (hasDouble && !hasSingle)
          qs = singleQuotedString;
        else if (hasSingle && !hasDouble)
          qs = doubleQuotedString;
        else
          qs = singleQuote ? singleQuotedString : doubleQuotedString;
      }
      return qs(value, ctx);
    }
    var blockEndNewlines;
    try {
      blockEndNewlines = new RegExp("(^|(?<!\n))\n+(?!\n|$)", "g");
    } catch {
      blockEndNewlines = /\n+(?!\n|$)/g;
    }
    function blockString({ comment, type, value }, ctx, onComment, onChompKeep) {
      const { blockQuote, commentString, lineWidth } = ctx.options;
      if (!blockQuote || /\n[\t ]+$/.test(value)) {
        return quotedString(value, ctx);
      }
      const indent = ctx.indent || (ctx.forceBlockIndent || containsDocumentMarker(value) ? "  " : "");
      const literal = blockQuote === "literal" ? true : blockQuote === "folded" || type === Scalar.Scalar.BLOCK_FOLDED ? false : type === Scalar.Scalar.BLOCK_LITERAL ? true : !lineLengthOverLimit(value, lineWidth, indent.length);
      if (!value)
        return literal ? "|\n" : ">\n";
      let chomp;
      let endStart;
      for (endStart = value.length; endStart > 0; --endStart) {
        const ch = value[endStart - 1];
        if (ch !== "\n" && ch !== "	" && ch !== " ")
          break;
      }
      let end = value.substring(endStart);
      const endNlPos = end.indexOf("\n");
      if (endNlPos === -1) {
        chomp = "-";
      } else if (value === end || endNlPos !== end.length - 1) {
        chomp = "+";
        if (onChompKeep)
          onChompKeep();
      } else {
        chomp = "";
      }
      if (end) {
        value = value.slice(0, -end.length);
        if (end[end.length - 1] === "\n")
          end = end.slice(0, -1);
        end = end.replace(blockEndNewlines, `$&${indent}`);
      }
      let startWithSpace = false;
      let startEnd;
      let startNlPos = -1;
      for (startEnd = 0; startEnd < value.length; ++startEnd) {
        const ch = value[startEnd];
        if (ch === " ")
          startWithSpace = true;
        else if (ch === "\n")
          startNlPos = startEnd;
        else
          break;
      }
      let start = value.substring(0, startNlPos < startEnd ? startNlPos + 1 : startEnd);
      if (start) {
        value = value.substring(start.length);
        start = start.replace(/\n+/g, `$&${indent}`);
      }
      const indentSize = indent ? "2" : "1";
      let header = (startWithSpace ? indentSize : "") + chomp;
      if (comment) {
        header += " " + commentString(comment.replace(/ ?[\r\n]+/g, " "));
        if (onComment)
          onComment();
      }
      if (!literal) {
        const foldedValue = value.replace(/\n+/g, "\n$&").replace(/(?:^|\n)([\t ].*)(?:([\n\t ]*)\n(?![\n\t ]))?/g, "$1$2").replace(/\n+/g, `$&${indent}`);
        let literalFallback = false;
        const foldOptions = getFoldOptions(ctx, true);
        if (blockQuote !== "folded" && type !== Scalar.Scalar.BLOCK_FOLDED) {
          foldOptions.onOverflow = () => {
            literalFallback = true;
          };
        }
        const body = foldFlowLines.foldFlowLines(`${start}${foldedValue}${end}`, indent, foldFlowLines.FOLD_BLOCK, foldOptions);
        if (!literalFallback)
          return `>${header}
${indent}${body}`;
      }
      value = value.replace(/\n+/g, `$&${indent}`);
      return `|${header}
${indent}${start}${value}${end}`;
    }
    function plainString(item, ctx, onComment, onChompKeep) {
      const { type, value } = item;
      const { actualString, implicitKey, indent, indentStep, inFlow } = ctx;
      if (implicitKey && value.includes("\n") || inFlow && /[[\]{},]/.test(value)) {
        return quotedString(value, ctx);
      }
      if (/^[\n\t ,[\]{}#&*!|>'"%@`]|^[?-]$|^[?-][ \t]|[\n:][ \t]|[ \t]\n|[\n\t ]#|[\n\t :]$/.test(value)) {
        return implicitKey || inFlow || !value.includes("\n") ? quotedString(value, ctx) : blockString(item, ctx, onComment, onChompKeep);
      }
      if (!implicitKey && !inFlow && type !== Scalar.Scalar.PLAIN && value.includes("\n")) {
        return blockString(item, ctx, onComment, onChompKeep);
      }
      if (containsDocumentMarker(value)) {
        if (indent === "") {
          ctx.forceBlockIndent = true;
          return blockString(item, ctx, onComment, onChompKeep);
        } else if (implicitKey && indent === indentStep) {
          return quotedString(value, ctx);
        }
      }
      const str = value.replace(/\n+/g, `$&
${indent}`);
      if (actualString) {
        const test = (tag) => tag.default && tag.tag !== "tag:yaml.org,2002:str" && tag.test?.test(str);
        const { compat, tags } = ctx.doc.schema;
        if (tags.some(test) || compat?.some(test))
          return quotedString(value, ctx);
      }
      return implicitKey ? str : foldFlowLines.foldFlowLines(str, indent, foldFlowLines.FOLD_FLOW, getFoldOptions(ctx, false));
    }
    function stringifyString(item, ctx, onComment, onChompKeep) {
      const { implicitKey, inFlow } = ctx;
      const ss = typeof item.value === "string" ? item : Object.assign({}, item, { value: String(item.value) });
      let { type } = item;
      if (type !== Scalar.Scalar.QUOTE_DOUBLE) {
        if (/[\x00-\x08\x0b-\x1f\x7f-\x9f\u{D800}-\u{DFFF}]/u.test(ss.value))
          type = Scalar.Scalar.QUOTE_DOUBLE;
      }
      const _stringify = (_type) => {
        switch (_type) {
          case Scalar.Scalar.BLOCK_FOLDED:
          case Scalar.Scalar.BLOCK_LITERAL:
            return implicitKey || inFlow ? quotedString(ss.value, ctx) : blockString(ss, ctx, onComment, onChompKeep);
          case Scalar.Scalar.QUOTE_DOUBLE:
            return doubleQuotedString(ss.value, ctx);
          case Scalar.Scalar.QUOTE_SINGLE:
            return singleQuotedString(ss.value, ctx);
          case Scalar.Scalar.PLAIN:
            return plainString(ss, ctx, onComment, onChompKeep);
          default:
            return null;
        }
      };
      let res = _stringify(type);
      if (res === null) {
        const { defaultKeyType, defaultStringType } = ctx.options;
        const t = implicitKey && defaultKeyType || defaultStringType;
        res = _stringify(t);
        if (res === null)
          throw new Error(`Unsupported default string type ${t}`);
      }
      return res;
    }
    exports2.stringifyString = stringifyString;
  }
});

// ../node_modules/yaml/dist/stringify/stringify.js
var require_stringify = __commonJS({
  "../node_modules/yaml/dist/stringify/stringify.js"(exports2) {
    "use strict";
    var anchors = require_anchors();
    var identity = require_identity();
    var stringifyComment = require_stringifyComment();
    var stringifyString = require_stringifyString();
    function createStringifyContext(doc, options) {
      const opt = Object.assign({
        blockQuote: true,
        commentString: stringifyComment.stringifyComment,
        defaultKeyType: null,
        defaultStringType: "PLAIN",
        directives: null,
        doubleQuotedAsJSON: false,
        doubleQuotedMinMultiLineLength: 40,
        falseStr: "false",
        flowCollectionPadding: true,
        indentSeq: true,
        lineWidth: 80,
        minContentWidth: 20,
        nullStr: "null",
        simpleKeys: false,
        singleQuote: null,
        trailingComma: false,
        trueStr: "true",
        verifyAliasOrder: true
      }, doc.schema.toStringOptions, options);
      let inFlow;
      switch (opt.collectionStyle) {
        case "block":
          inFlow = false;
          break;
        case "flow":
          inFlow = true;
          break;
        default:
          inFlow = null;
      }
      return {
        anchors: /* @__PURE__ */ new Set(),
        doc,
        flowCollectionPadding: opt.flowCollectionPadding ? " " : "",
        indent: "",
        indentStep: typeof opt.indent === "number" ? " ".repeat(opt.indent) : "  ",
        inFlow,
        options: opt
      };
    }
    function getTagObject(tags, item) {
      if (item.tag) {
        const match = tags.filter((t) => t.tag === item.tag);
        if (match.length > 0)
          return match.find((t) => t.format === item.format) ?? match[0];
      }
      let tagObj = void 0;
      let obj;
      if (identity.isScalar(item)) {
        obj = item.value;
        let match = tags.filter((t) => t.identify?.(obj));
        if (match.length > 1) {
          const testMatch = match.filter((t) => t.test);
          if (testMatch.length > 0)
            match = testMatch;
        }
        tagObj = match.find((t) => t.format === item.format) ?? match.find((t) => !t.format);
      } else {
        obj = item;
        tagObj = tags.find((t) => t.nodeClass && obj instanceof t.nodeClass);
      }
      if (!tagObj) {
        const name = obj?.constructor?.name ?? (obj === null ? "null" : typeof obj);
        throw new Error(`Tag not resolved for ${name} value`);
      }
      return tagObj;
    }
    function stringifyProps(node, tagObj, { anchors: anchors$1, doc }) {
      if (!doc.directives)
        return "";
      const props = [];
      const anchor = (identity.isScalar(node) || identity.isCollection(node)) && node.anchor;
      if (anchor && anchors.anchorIsValid(anchor)) {
        anchors$1.add(anchor);
        props.push(`&${anchor}`);
      }
      const tag = node.tag ?? (tagObj.default ? null : tagObj.tag);
      if (tag)
        props.push(doc.directives.tagString(tag));
      return props.join(" ");
    }
    function stringify(item, ctx, onComment, onChompKeep) {
      if (identity.isPair(item))
        return item.toString(ctx, onComment, onChompKeep);
      if (identity.isAlias(item)) {
        if (ctx.doc.directives)
          return item.toString(ctx);
        if (ctx.resolvedAliases?.has(item)) {
          throw new TypeError(`Cannot stringify circular structure without alias nodes`);
        } else {
          if (ctx.resolvedAliases)
            ctx.resolvedAliases.add(item);
          else
            ctx.resolvedAliases = /* @__PURE__ */ new Set([item]);
          item = item.resolve(ctx.doc);
        }
      }
      let tagObj = void 0;
      const node = identity.isNode(item) ? item : ctx.doc.createNode(item, { onTagObj: (o) => tagObj = o });
      tagObj ?? (tagObj = getTagObject(ctx.doc.schema.tags, node));
      const props = stringifyProps(node, tagObj, ctx);
      if (props.length > 0)
        ctx.indentAtStart = (ctx.indentAtStart ?? 0) + props.length + 1;
      const str = typeof tagObj.stringify === "function" ? tagObj.stringify(node, ctx, onComment, onChompKeep) : identity.isScalar(node) ? stringifyString.stringifyString(node, ctx, onComment, onChompKeep) : node.toString(ctx, onComment, onChompKeep);
      if (!props)
        return str;
      return identity.isScalar(node) || str[0] === "{" || str[0] === "[" ? `${props} ${str}` : `${props}
${ctx.indent}${str}`;
    }
    exports2.createStringifyContext = createStringifyContext;
    exports2.stringify = stringify;
  }
});

// ../node_modules/yaml/dist/stringify/stringifyPair.js
var require_stringifyPair = __commonJS({
  "../node_modules/yaml/dist/stringify/stringifyPair.js"(exports2) {
    "use strict";
    var identity = require_identity();
    var Scalar = require_Scalar();
    var stringify = require_stringify();
    var stringifyComment = require_stringifyComment();
    function stringifyPair({ key, value }, ctx, onComment, onChompKeep) {
      const { allNullValues, doc, indent, indentStep, options: { commentString, indentSeq, simpleKeys } } = ctx;
      let keyComment = identity.isNode(key) && key.comment || null;
      if (simpleKeys) {
        if (keyComment) {
          throw new Error("With simple keys, key nodes cannot have comments");
        }
        if (identity.isCollection(key) || !identity.isNode(key) && typeof key === "object") {
          const msg = "With simple keys, collection cannot be used as a key value";
          throw new Error(msg);
        }
      }
      let explicitKey = !simpleKeys && (!key || keyComment && value == null && !ctx.inFlow || identity.isCollection(key) || (identity.isScalar(key) ? key.type === Scalar.Scalar.BLOCK_FOLDED || key.type === Scalar.Scalar.BLOCK_LITERAL : typeof key === "object"));
      ctx = Object.assign({}, ctx, {
        allNullValues: false,
        implicitKey: !explicitKey && (simpleKeys || !allNullValues),
        indent: indent + indentStep
      });
      let keyCommentDone = false;
      let chompKeep = false;
      let str = stringify.stringify(key, ctx, () => keyCommentDone = true, () => chompKeep = true);
      if (!explicitKey && !ctx.inFlow && str.length > 1024) {
        if (simpleKeys)
          throw new Error("With simple keys, single line scalar must not span more than 1024 characters");
        explicitKey = true;
      }
      if (ctx.inFlow) {
        if (allNullValues || value == null) {
          if (keyCommentDone && onComment)
            onComment();
          return str === "" ? "?" : explicitKey ? `? ${str}` : str;
        }
      } else if (allNullValues && !simpleKeys || value == null && explicitKey) {
        str = `? ${str}`;
        if (keyComment && !keyCommentDone) {
          str += stringifyComment.lineComment(str, ctx.indent, commentString(keyComment));
        } else if (chompKeep && onChompKeep)
          onChompKeep();
        return str;
      }
      if (keyCommentDone)
        keyComment = null;
      if (explicitKey) {
        if (keyComment)
          str += stringifyComment.lineComment(str, ctx.indent, commentString(keyComment));
        str = `? ${str}
${indent}:`;
      } else {
        str = `${str}:`;
        if (keyComment)
          str += stringifyComment.lineComment(str, ctx.indent, commentString(keyComment));
      }
      let vsb, vcb, valueComment;
      if (identity.isNode(value)) {
        vsb = !!value.spaceBefore;
        vcb = value.commentBefore;
        valueComment = value.comment;
      } else {
        vsb = false;
        vcb = null;
        valueComment = null;
        if (value && typeof value === "object")
          value = doc.createNode(value);
      }
      ctx.implicitKey = false;
      if (!explicitKey && !keyComment && identity.isScalar(value))
        ctx.indentAtStart = str.length + 1;
      chompKeep = false;
      if (!indentSeq && indentStep.length >= 2 && !ctx.inFlow && !explicitKey && identity.isSeq(value) && !value.flow && !value.tag && !value.anchor) {
        ctx.indent = ctx.indent.substring(2);
      }
      let valueCommentDone = false;
      const valueStr = stringify.stringify(value, ctx, () => valueCommentDone = true, () => chompKeep = true);
      let ws = " ";
      if (keyComment || vsb || vcb) {
        ws = vsb ? "\n" : "";
        if (vcb) {
          const cs = commentString(vcb);
          ws += `
${stringifyComment.indentComment(cs, ctx.indent)}`;
        }
        if (valueStr === "" && !ctx.inFlow) {
          if (ws === "\n" && valueComment)
            ws = "\n\n";
        } else {
          ws += `
${ctx.indent}`;
        }
      } else if (!explicitKey && identity.isCollection(value)) {
        const vs0 = valueStr[0];
        const nl0 = valueStr.indexOf("\n");
        const hasNewline = nl0 !== -1;
        const flow = ctx.inFlow ?? value.flow ?? value.items.length === 0;
        if (hasNewline || !flow) {
          let hasPropsLine = false;
          if (hasNewline && (vs0 === "&" || vs0 === "!")) {
            let sp0 = valueStr.indexOf(" ");
            if (vs0 === "&" && sp0 !== -1 && sp0 < nl0 && valueStr[sp0 + 1] === "!") {
              sp0 = valueStr.indexOf(" ", sp0 + 1);
            }
            if (sp0 === -1 || nl0 < sp0)
              hasPropsLine = true;
          }
          if (!hasPropsLine)
            ws = `
${ctx.indent}`;
        }
      } else if (valueStr === "" || valueStr[0] === "\n") {
        ws = "";
      }
      str += ws + valueStr;
      if (ctx.inFlow) {
        if (valueCommentDone && onComment)
          onComment();
      } else if (valueComment && !valueCommentDone) {
        str += stringifyComment.lineComment(str, ctx.indent, commentString(valueComment));
      } else if (chompKeep && onChompKeep) {
        onChompKeep();
      }
      return str;
    }
    exports2.stringifyPair = stringifyPair;
  }
});

// ../node_modules/yaml/dist/log.js
var require_log = __commonJS({
  "../node_modules/yaml/dist/log.js"(exports2) {
    "use strict";
    var node_process = require("process");
    function debug(logLevel, ...messages) {
      if (logLevel === "debug")
        console.log(...messages);
    }
    function warn(logLevel, warning) {
      if (logLevel === "debug" || logLevel === "warn") {
        if (typeof node_process.emitWarning === "function")
          node_process.emitWarning(warning);
        else
          console.warn(warning);
      }
    }
    exports2.debug = debug;
    exports2.warn = warn;
  }
});

// ../node_modules/yaml/dist/schema/yaml-1.1/merge.js
var require_merge = __commonJS({
  "../node_modules/yaml/dist/schema/yaml-1.1/merge.js"(exports2) {
    "use strict";
    var identity = require_identity();
    var Scalar = require_Scalar();
    var MERGE_KEY = "<<";
    var merge = {
      identify: (value) => value === MERGE_KEY || typeof value === "symbol" && value.description === MERGE_KEY,
      default: "key",
      tag: "tag:yaml.org,2002:merge",
      test: /^<<$/,
      resolve: () => Object.assign(new Scalar.Scalar(Symbol(MERGE_KEY)), {
        addToJSMap: addMergeToJSMap
      }),
      stringify: () => MERGE_KEY
    };
    var isMergeKey = (ctx, key) => (merge.identify(key) || identity.isScalar(key) && (!key.type || key.type === Scalar.Scalar.PLAIN) && merge.identify(key.value)) && ctx?.doc.schema.tags.some((tag) => tag.tag === merge.tag && tag.default);
    function addMergeToJSMap(ctx, map, value) {
      const source = resolveAliasValue(ctx, value);
      if (identity.isSeq(source))
        for (const it of source.items)
          mergeValue(ctx, map, it);
      else if (Array.isArray(source))
        for (const it of source)
          mergeValue(ctx, map, it);
      else
        mergeValue(ctx, map, source);
    }
    function mergeValue(ctx, map, value) {
      const source = resolveAliasValue(ctx, value);
      if (!identity.isMap(source))
        throw new Error("Merge sources must be maps or map aliases");
      const srcMap = source.toJSON(null, ctx, Map);
      for (const [key, value2] of srcMap) {
        if (map instanceof Map) {
          if (!map.has(key))
            map.set(key, value2);
        } else if (map instanceof Set) {
          map.add(key);
        } else if (!Object.prototype.hasOwnProperty.call(map, key)) {
          Object.defineProperty(map, key, {
            value: value2,
            writable: true,
            enumerable: true,
            configurable: true
          });
        }
      }
      return map;
    }
    function resolveAliasValue(ctx, value) {
      return ctx && identity.isAlias(value) ? value.resolve(ctx.doc, ctx) : value;
    }
    exports2.addMergeToJSMap = addMergeToJSMap;
    exports2.isMergeKey = isMergeKey;
    exports2.merge = merge;
  }
});

// ../node_modules/yaml/dist/nodes/addPairToJSMap.js
var require_addPairToJSMap = __commonJS({
  "../node_modules/yaml/dist/nodes/addPairToJSMap.js"(exports2) {
    "use strict";
    var log2 = require_log();
    var merge = require_merge();
    var stringify = require_stringify();
    var identity = require_identity();
    var toJS = require_toJS();
    function addPairToJSMap(ctx, map, { key, value }) {
      if (identity.isNode(key) && key.addToJSMap)
        key.addToJSMap(ctx, map, value);
      else if (merge.isMergeKey(ctx, key))
        merge.addMergeToJSMap(ctx, map, value);
      else {
        const jsKey = toJS.toJS(key, "", ctx);
        if (map instanceof Map) {
          map.set(jsKey, toJS.toJS(value, jsKey, ctx));
        } else if (map instanceof Set) {
          map.add(jsKey);
        } else {
          const stringKey = stringifyKey(key, jsKey, ctx);
          const jsValue = toJS.toJS(value, stringKey, ctx);
          if (stringKey in map)
            Object.defineProperty(map, stringKey, {
              value: jsValue,
              writable: true,
              enumerable: true,
              configurable: true
            });
          else
            map[stringKey] = jsValue;
        }
      }
      return map;
    }
    function stringifyKey(key, jsKey, ctx) {
      if (jsKey === null)
        return "";
      if (typeof jsKey !== "object")
        return String(jsKey);
      if (identity.isNode(key) && ctx?.doc) {
        const strCtx = stringify.createStringifyContext(ctx.doc, {});
        strCtx.anchors = /* @__PURE__ */ new Set();
        for (const node of ctx.anchors.keys())
          strCtx.anchors.add(node.anchor);
        strCtx.inFlow = true;
        strCtx.inStringifyKey = true;
        const strKey = key.toString(strCtx);
        if (!ctx.mapKeyWarned) {
          let jsonStr = JSON.stringify(strKey);
          if (jsonStr.length > 40)
            jsonStr = jsonStr.substring(0, 36) + '..."';
          log2.warn(ctx.doc.options.logLevel, `Keys with collection values will be stringified due to JS Object restrictions: ${jsonStr}. Set mapAsMap: true to use object keys.`);
          ctx.mapKeyWarned = true;
        }
        return strKey;
      }
      return JSON.stringify(jsKey);
    }
    exports2.addPairToJSMap = addPairToJSMap;
  }
});

// ../node_modules/yaml/dist/nodes/Pair.js
var require_Pair = __commonJS({
  "../node_modules/yaml/dist/nodes/Pair.js"(exports2) {
    "use strict";
    var createNode = require_createNode();
    var stringifyPair = require_stringifyPair();
    var addPairToJSMap = require_addPairToJSMap();
    var identity = require_identity();
    function createPair(key, value, ctx) {
      const k = createNode.createNode(key, void 0, ctx);
      const v = createNode.createNode(value, void 0, ctx);
      return new Pair(k, v);
    }
    var Pair = class _Pair {
      constructor(key, value = null) {
        Object.defineProperty(this, identity.NODE_TYPE, { value: identity.PAIR });
        this.key = key;
        this.value = value;
      }
      clone(schema) {
        let { key, value } = this;
        if (identity.isNode(key))
          key = key.clone(schema);
        if (identity.isNode(value))
          value = value.clone(schema);
        return new _Pair(key, value);
      }
      toJSON(_, ctx) {
        const pair = ctx?.mapAsMap ? /* @__PURE__ */ new Map() : {};
        return addPairToJSMap.addPairToJSMap(ctx, pair, this);
      }
      toString(ctx, onComment, onChompKeep) {
        return ctx?.doc ? stringifyPair.stringifyPair(this, ctx, onComment, onChompKeep) : JSON.stringify(this);
      }
    };
    exports2.Pair = Pair;
    exports2.createPair = createPair;
  }
});

// ../node_modules/yaml/dist/stringify/stringifyCollection.js
var require_stringifyCollection = __commonJS({
  "../node_modules/yaml/dist/stringify/stringifyCollection.js"(exports2) {
    "use strict";
    var identity = require_identity();
    var stringify = require_stringify();
    var stringifyComment = require_stringifyComment();
    function stringifyCollection(collection, ctx, options) {
      const flow = ctx.inFlow ?? collection.flow;
      const stringify2 = flow ? stringifyFlowCollection : stringifyBlockCollection;
      return stringify2(collection, ctx, options);
    }
    function stringifyBlockCollection({ comment, items }, ctx, { blockItemPrefix, flowChars, itemIndent, onChompKeep, onComment }) {
      const { indent, options: { commentString } } = ctx;
      const itemCtx = Object.assign({}, ctx, { indent: itemIndent, type: null });
      let chompKeep = false;
      const lines = [];
      for (let i = 0; i < items.length; ++i) {
        const item = items[i];
        let comment2 = null;
        if (identity.isNode(item)) {
          if (!chompKeep && item.spaceBefore)
            lines.push("");
          addCommentBefore(ctx, lines, item.commentBefore, chompKeep);
          if (item.comment)
            comment2 = item.comment;
        } else if (identity.isPair(item)) {
          const ik = identity.isNode(item.key) ? item.key : null;
          if (ik) {
            if (!chompKeep && ik.spaceBefore)
              lines.push("");
            addCommentBefore(ctx, lines, ik.commentBefore, chompKeep);
          }
        }
        chompKeep = false;
        let str2 = stringify.stringify(item, itemCtx, () => comment2 = null, () => chompKeep = true);
        if (comment2)
          str2 += stringifyComment.lineComment(str2, itemIndent, commentString(comment2));
        if (chompKeep && comment2)
          chompKeep = false;
        lines.push(blockItemPrefix + str2);
      }
      let str;
      if (lines.length === 0) {
        str = flowChars.start + flowChars.end;
      } else {
        str = lines[0];
        for (let i = 1; i < lines.length; ++i) {
          const line = lines[i];
          str += line ? `
${indent}${line}` : "\n";
        }
      }
      if (comment) {
        str += "\n" + stringifyComment.indentComment(commentString(comment), indent);
        if (onComment)
          onComment();
      } else if (chompKeep && onChompKeep)
        onChompKeep();
      return str;
    }
    function stringifyFlowCollection({ items }, ctx, { flowChars, itemIndent }) {
      const { indent, indentStep, flowCollectionPadding: fcPadding, options: { commentString } } = ctx;
      itemIndent += indentStep;
      const itemCtx = Object.assign({}, ctx, {
        indent: itemIndent,
        inFlow: true,
        type: null
      });
      let reqNewline = false;
      let linesAtValue = 0;
      const lines = [];
      for (let i = 0; i < items.length; ++i) {
        const item = items[i];
        let comment = null;
        if (identity.isNode(item)) {
          if (item.spaceBefore)
            lines.push("");
          addCommentBefore(ctx, lines, item.commentBefore, false);
          if (item.comment)
            comment = item.comment;
        } else if (identity.isPair(item)) {
          const ik = identity.isNode(item.key) ? item.key : null;
          if (ik) {
            if (ik.spaceBefore)
              lines.push("");
            addCommentBefore(ctx, lines, ik.commentBefore, false);
            if (ik.comment)
              reqNewline = true;
          }
          const iv = identity.isNode(item.value) ? item.value : null;
          if (iv) {
            if (iv.comment)
              comment = iv.comment;
            if (iv.commentBefore)
              reqNewline = true;
          } else if (item.value == null && ik?.comment) {
            comment = ik.comment;
          }
        }
        if (comment)
          reqNewline = true;
        let str = stringify.stringify(item, itemCtx, () => comment = null);
        reqNewline || (reqNewline = lines.length > linesAtValue || str.includes("\n"));
        if (i < items.length - 1) {
          str += ",";
        } else if (ctx.options.trailingComma) {
          if (ctx.options.lineWidth > 0) {
            reqNewline || (reqNewline = lines.reduce((sum, line) => sum + line.length + 2, 2) + (str.length + 2) > ctx.options.lineWidth);
          }
          if (reqNewline) {
            str += ",";
          }
        }
        if (comment)
          str += stringifyComment.lineComment(str, itemIndent, commentString(comment));
        lines.push(str);
        linesAtValue = lines.length;
      }
      const { start, end } = flowChars;
      if (lines.length === 0) {
        return start + end;
      } else {
        if (!reqNewline) {
          const len = lines.reduce((sum, line) => sum + line.length + 2, 2);
          reqNewline = ctx.options.lineWidth > 0 && len > ctx.options.lineWidth;
        }
        if (reqNewline) {
          let str = start;
          for (const line of lines)
            str += line ? `
${indentStep}${indent}${line}` : "\n";
          return `${str}
${indent}${end}`;
        } else {
          return `${start}${fcPadding}${lines.join(" ")}${fcPadding}${end}`;
        }
      }
    }
    function addCommentBefore({ indent, options: { commentString } }, lines, comment, chompKeep) {
      if (comment && chompKeep)
        comment = comment.replace(/^\n+/, "");
      if (comment) {
        const ic = stringifyComment.indentComment(commentString(comment), indent);
        lines.push(ic.trimStart());
      }
    }
    exports2.stringifyCollection = stringifyCollection;
  }
});

// ../node_modules/yaml/dist/nodes/YAMLMap.js
var require_YAMLMap = __commonJS({
  "../node_modules/yaml/dist/nodes/YAMLMap.js"(exports2) {
    "use strict";
    var stringifyCollection = require_stringifyCollection();
    var addPairToJSMap = require_addPairToJSMap();
    var Collection = require_Collection();
    var identity = require_identity();
    var Pair = require_Pair();
    var Scalar = require_Scalar();
    function findPair(items, key) {
      const k = identity.isScalar(key) ? key.value : key;
      for (const it of items) {
        if (identity.isPair(it)) {
          if (it.key === key || it.key === k)
            return it;
          if (identity.isScalar(it.key) && it.key.value === k)
            return it;
        }
      }
      return void 0;
    }
    var YAMLMap = class extends Collection.Collection {
      static get tagName() {
        return "tag:yaml.org,2002:map";
      }
      constructor(schema) {
        super(identity.MAP, schema);
        this.items = [];
      }
      /**
       * A generic collection parsing method that can be extended
       * to other node classes that inherit from YAMLMap
       */
      static from(schema, obj, ctx) {
        const { keepUndefined, replacer } = ctx;
        const map = new this(schema);
        const add = (key, value) => {
          if (typeof replacer === "function")
            value = replacer.call(obj, key, value);
          else if (Array.isArray(replacer) && !replacer.includes(key))
            return;
          if (value !== void 0 || keepUndefined)
            map.items.push(Pair.createPair(key, value, ctx));
        };
        if (obj instanceof Map) {
          for (const [key, value] of obj)
            add(key, value);
        } else if (obj && typeof obj === "object") {
          for (const key of Object.keys(obj))
            add(key, obj[key]);
        }
        if (typeof schema.sortMapEntries === "function") {
          map.items.sort(schema.sortMapEntries);
        }
        return map;
      }
      /**
       * Adds a value to the collection.
       *
       * @param overwrite - If not set `true`, using a key that is already in the
       *   collection will throw. Otherwise, overwrites the previous value.
       */
      add(pair, overwrite) {
        let _pair;
        if (identity.isPair(pair))
          _pair = pair;
        else if (!pair || typeof pair !== "object" || !("key" in pair)) {
          _pair = new Pair.Pair(pair, pair?.value);
        } else
          _pair = new Pair.Pair(pair.key, pair.value);
        const prev = findPair(this.items, _pair.key);
        const sortEntries = this.schema?.sortMapEntries;
        if (prev) {
          if (!overwrite)
            throw new Error(`Key ${_pair.key} already set`);
          if (identity.isScalar(prev.value) && Scalar.isScalarValue(_pair.value))
            prev.value.value = _pair.value;
          else
            prev.value = _pair.value;
        } else if (sortEntries) {
          const i = this.items.findIndex((item) => sortEntries(_pair, item) < 0);
          if (i === -1)
            this.items.push(_pair);
          else
            this.items.splice(i, 0, _pair);
        } else {
          this.items.push(_pair);
        }
      }
      delete(key) {
        const it = findPair(this.items, key);
        if (!it)
          return false;
        const del = this.items.splice(this.items.indexOf(it), 1);
        return del.length > 0;
      }
      get(key, keepScalar) {
        const it = findPair(this.items, key);
        const node = it?.value;
        return (!keepScalar && identity.isScalar(node) ? node.value : node) ?? void 0;
      }
      has(key) {
        return !!findPair(this.items, key);
      }
      set(key, value) {
        this.add(new Pair.Pair(key, value), true);
      }
      /**
       * @param ctx - Conversion context, originally set in Document#toJS()
       * @param {Class} Type - If set, forces the returned collection type
       * @returns Instance of Type, Map, or Object
       */
      toJSON(_, ctx, Type) {
        const map = Type ? new Type() : ctx?.mapAsMap ? /* @__PURE__ */ new Map() : {};
        if (ctx?.onCreate)
          ctx.onCreate(map);
        for (const item of this.items)
          addPairToJSMap.addPairToJSMap(ctx, map, item);
        return map;
      }
      toString(ctx, onComment, onChompKeep) {
        if (!ctx)
          return JSON.stringify(this);
        for (const item of this.items) {
          if (!identity.isPair(item))
            throw new Error(`Map items must all be pairs; found ${JSON.stringify(item)} instead`);
        }
        if (!ctx.allNullValues && this.hasAllNullValues(false))
          ctx = Object.assign({}, ctx, { allNullValues: true });
        return stringifyCollection.stringifyCollection(this, ctx, {
          blockItemPrefix: "",
          flowChars: { start: "{", end: "}" },
          itemIndent: ctx.indent || "",
          onChompKeep,
          onComment
        });
      }
    };
    exports2.YAMLMap = YAMLMap;
    exports2.findPair = findPair;
  }
});

// ../node_modules/yaml/dist/schema/common/map.js
var require_map = __commonJS({
  "../node_modules/yaml/dist/schema/common/map.js"(exports2) {
    "use strict";
    var identity = require_identity();
    var YAMLMap = require_YAMLMap();
    var map = {
      collection: "map",
      default: true,
      nodeClass: YAMLMap.YAMLMap,
      tag: "tag:yaml.org,2002:map",
      resolve(map2, onError) {
        if (!identity.isMap(map2))
          onError("Expected a mapping for this tag");
        return map2;
      },
      createNode: (schema, obj, ctx) => YAMLMap.YAMLMap.from(schema, obj, ctx)
    };
    exports2.map = map;
  }
});

// ../node_modules/yaml/dist/nodes/YAMLSeq.js
var require_YAMLSeq = __commonJS({
  "../node_modules/yaml/dist/nodes/YAMLSeq.js"(exports2) {
    "use strict";
    var createNode = require_createNode();
    var stringifyCollection = require_stringifyCollection();
    var Collection = require_Collection();
    var identity = require_identity();
    var Scalar = require_Scalar();
    var toJS = require_toJS();
    var YAMLSeq = class extends Collection.Collection {
      static get tagName() {
        return "tag:yaml.org,2002:seq";
      }
      constructor(schema) {
        super(identity.SEQ, schema);
        this.items = [];
      }
      add(value) {
        this.items.push(value);
      }
      /**
       * Removes a value from the collection.
       *
       * `key` must contain a representation of an integer for this to succeed.
       * It may be wrapped in a `Scalar`.
       *
       * @returns `true` if the item was found and removed.
       */
      delete(key) {
        const idx = asItemIndex(key);
        if (typeof idx !== "number")
          return false;
        const del = this.items.splice(idx, 1);
        return del.length > 0;
      }
      get(key, keepScalar) {
        const idx = asItemIndex(key);
        if (typeof idx !== "number")
          return void 0;
        const it = this.items[idx];
        return !keepScalar && identity.isScalar(it) ? it.value : it;
      }
      /**
       * Checks if the collection includes a value with the key `key`.
       *
       * `key` must contain a representation of an integer for this to succeed.
       * It may be wrapped in a `Scalar`.
       */
      has(key) {
        const idx = asItemIndex(key);
        return typeof idx === "number" && idx < this.items.length;
      }
      /**
       * Sets a value in this collection. For `!!set`, `value` needs to be a
       * boolean to add/remove the item from the set.
       *
       * If `key` does not contain a representation of an integer, this will throw.
       * It may be wrapped in a `Scalar`.
       */
      set(key, value) {
        const idx = asItemIndex(key);
        if (typeof idx !== "number")
          throw new Error(`Expected a valid index, not ${key}.`);
        const prev = this.items[idx];
        if (identity.isScalar(prev) && Scalar.isScalarValue(value))
          prev.value = value;
        else
          this.items[idx] = value;
      }
      toJSON(_, ctx) {
        const seq = [];
        if (ctx?.onCreate)
          ctx.onCreate(seq);
        let i = 0;
        for (const item of this.items)
          seq.push(toJS.toJS(item, String(i++), ctx));
        return seq;
      }
      toString(ctx, onComment, onChompKeep) {
        if (!ctx)
          return JSON.stringify(this);
        return stringifyCollection.stringifyCollection(this, ctx, {
          blockItemPrefix: "- ",
          flowChars: { start: "[", end: "]" },
          itemIndent: (ctx.indent || "") + "  ",
          onChompKeep,
          onComment
        });
      }
      static from(schema, obj, ctx) {
        const { replacer } = ctx;
        const seq = new this(schema);
        if (obj && Symbol.iterator in Object(obj)) {
          let i = 0;
          for (let it of obj) {
            if (typeof replacer === "function") {
              const key = obj instanceof Set ? it : String(i++);
              it = replacer.call(obj, key, it);
            }
            seq.items.push(createNode.createNode(it, void 0, ctx));
          }
        }
        return seq;
      }
    };
    function asItemIndex(key) {
      let idx = identity.isScalar(key) ? key.value : key;
      if (idx && typeof idx === "string")
        idx = Number(idx);
      return typeof idx === "number" && Number.isInteger(idx) && idx >= 0 ? idx : null;
    }
    exports2.YAMLSeq = YAMLSeq;
  }
});

// ../node_modules/yaml/dist/schema/common/seq.js
var require_seq = __commonJS({
  "../node_modules/yaml/dist/schema/common/seq.js"(exports2) {
    "use strict";
    var identity = require_identity();
    var YAMLSeq = require_YAMLSeq();
    var seq = {
      collection: "seq",
      default: true,
      nodeClass: YAMLSeq.YAMLSeq,
      tag: "tag:yaml.org,2002:seq",
      resolve(seq2, onError) {
        if (!identity.isSeq(seq2))
          onError("Expected a sequence for this tag");
        return seq2;
      },
      createNode: (schema, obj, ctx) => YAMLSeq.YAMLSeq.from(schema, obj, ctx)
    };
    exports2.seq = seq;
  }
});

// ../node_modules/yaml/dist/schema/common/string.js
var require_string = __commonJS({
  "../node_modules/yaml/dist/schema/common/string.js"(exports2) {
    "use strict";
    var stringifyString = require_stringifyString();
    var string = {
      identify: (value) => typeof value === "string",
      default: true,
      tag: "tag:yaml.org,2002:str",
      resolve: (str) => str,
      stringify(item, ctx, onComment, onChompKeep) {
        ctx = Object.assign({ actualString: true }, ctx);
        return stringifyString.stringifyString(item, ctx, onComment, onChompKeep);
      }
    };
    exports2.string = string;
  }
});

// ../node_modules/yaml/dist/schema/common/null.js
var require_null = __commonJS({
  "../node_modules/yaml/dist/schema/common/null.js"(exports2) {
    "use strict";
    var Scalar = require_Scalar();
    var nullTag = {
      identify: (value) => value == null,
      createNode: () => new Scalar.Scalar(null),
      default: true,
      tag: "tag:yaml.org,2002:null",
      test: /^(?:~|[Nn]ull|NULL)?$/,
      resolve: () => new Scalar.Scalar(null),
      stringify: ({ source }, ctx) => typeof source === "string" && nullTag.test.test(source) ? source : ctx.options.nullStr
    };
    exports2.nullTag = nullTag;
  }
});

// ../node_modules/yaml/dist/schema/core/bool.js
var require_bool = __commonJS({
  "../node_modules/yaml/dist/schema/core/bool.js"(exports2) {
    "use strict";
    var Scalar = require_Scalar();
    var boolTag = {
      identify: (value) => typeof value === "boolean",
      default: true,
      tag: "tag:yaml.org,2002:bool",
      test: /^(?:[Tt]rue|TRUE|[Ff]alse|FALSE)$/,
      resolve: (str) => new Scalar.Scalar(str[0] === "t" || str[0] === "T"),
      stringify({ source, value }, ctx) {
        if (source && boolTag.test.test(source)) {
          const sv = source[0] === "t" || source[0] === "T";
          if (value === sv)
            return source;
        }
        return value ? ctx.options.trueStr : ctx.options.falseStr;
      }
    };
    exports2.boolTag = boolTag;
  }
});

// ../node_modules/yaml/dist/stringify/stringifyNumber.js
var require_stringifyNumber = __commonJS({
  "../node_modules/yaml/dist/stringify/stringifyNumber.js"(exports2) {
    "use strict";
    function stringifyNumber({ format, minFractionDigits, tag, value }) {
      if (typeof value === "bigint")
        return String(value);
      const num2 = typeof value === "number" ? value : Number(value);
      if (!isFinite(num2))
        return isNaN(num2) ? ".nan" : num2 < 0 ? "-.inf" : ".inf";
      let n = Object.is(value, -0) ? "-0" : JSON.stringify(value);
      if (!format && minFractionDigits && (!tag || tag === "tag:yaml.org,2002:float") && /^-?\d/.test(n) && !n.includes("e")) {
        let i = n.indexOf(".");
        if (i < 0) {
          i = n.length;
          n += ".";
        }
        let d = minFractionDigits - (n.length - i - 1);
        while (d-- > 0)
          n += "0";
      }
      return n;
    }
    exports2.stringifyNumber = stringifyNumber;
  }
});

// ../node_modules/yaml/dist/schema/core/float.js
var require_float = __commonJS({
  "../node_modules/yaml/dist/schema/core/float.js"(exports2) {
    "use strict";
    var Scalar = require_Scalar();
    var stringifyNumber = require_stringifyNumber();
    var floatNaN = {
      identify: (value) => typeof value === "number",
      default: true,
      tag: "tag:yaml.org,2002:float",
      test: /^(?:[-+]?\.(?:inf|Inf|INF)|\.nan|\.NaN|\.NAN)$/,
      resolve: (str) => str.slice(-3).toLowerCase() === "nan" ? NaN : str[0] === "-" ? Number.NEGATIVE_INFINITY : Number.POSITIVE_INFINITY,
      stringify: stringifyNumber.stringifyNumber
    };
    var floatExp = {
      identify: (value) => typeof value === "number",
      default: true,
      tag: "tag:yaml.org,2002:float",
      format: "EXP",
      test: /^[-+]?(?:\.[0-9]+|[0-9]+(?:\.[0-9]*)?)[eE][-+]?[0-9]+$/,
      resolve: (str) => parseFloat(str),
      stringify(node) {
        const num2 = Number(node.value);
        return isFinite(num2) ? num2.toExponential() : stringifyNumber.stringifyNumber(node);
      }
    };
    var float = {
      identify: (value) => typeof value === "number",
      default: true,
      tag: "tag:yaml.org,2002:float",
      test: /^[-+]?(?:\.[0-9]+|[0-9]+\.[0-9]*)$/,
      resolve(str) {
        const node = new Scalar.Scalar(parseFloat(str));
        const dot = str.indexOf(".");
        if (dot !== -1 && str[str.length - 1] === "0")
          node.minFractionDigits = str.length - dot - 1;
        return node;
      },
      stringify: stringifyNumber.stringifyNumber
    };
    exports2.float = float;
    exports2.floatExp = floatExp;
    exports2.floatNaN = floatNaN;
  }
});

// ../node_modules/yaml/dist/schema/core/int.js
var require_int = __commonJS({
  "../node_modules/yaml/dist/schema/core/int.js"(exports2) {
    "use strict";
    var stringifyNumber = require_stringifyNumber();
    var intIdentify = (value) => typeof value === "bigint" || Number.isInteger(value);
    var intResolve = (str, offset, radix, { intAsBigInt }) => intAsBigInt ? BigInt(str) : parseInt(str.substring(offset), radix);
    function intStringify(node, radix, prefix) {
      const { value } = node;
      if (intIdentify(value) && value >= 0)
        return prefix + value.toString(radix);
      return stringifyNumber.stringifyNumber(node);
    }
    var intOct = {
      identify: (value) => intIdentify(value) && value >= 0,
      default: true,
      tag: "tag:yaml.org,2002:int",
      format: "OCT",
      test: /^0o[0-7]+$/,
      resolve: (str, _onError, opt) => intResolve(str, 2, 8, opt),
      stringify: (node) => intStringify(node, 8, "0o")
    };
    var int = {
      identify: intIdentify,
      default: true,
      tag: "tag:yaml.org,2002:int",
      test: /^[-+]?[0-9]+$/,
      resolve: (str, _onError, opt) => intResolve(str, 0, 10, opt),
      stringify: stringifyNumber.stringifyNumber
    };
    var intHex = {
      identify: (value) => intIdentify(value) && value >= 0,
      default: true,
      tag: "tag:yaml.org,2002:int",
      format: "HEX",
      test: /^0x[0-9a-fA-F]+$/,
      resolve: (str, _onError, opt) => intResolve(str, 2, 16, opt),
      stringify: (node) => intStringify(node, 16, "0x")
    };
    exports2.int = int;
    exports2.intHex = intHex;
    exports2.intOct = intOct;
  }
});

// ../node_modules/yaml/dist/schema/core/schema.js
var require_schema = __commonJS({
  "../node_modules/yaml/dist/schema/core/schema.js"(exports2) {
    "use strict";
    var map = require_map();
    var _null = require_null();
    var seq = require_seq();
    var string = require_string();
    var bool = require_bool();
    var float = require_float();
    var int = require_int();
    var schema = [
      map.map,
      seq.seq,
      string.string,
      _null.nullTag,
      bool.boolTag,
      int.intOct,
      int.int,
      int.intHex,
      float.floatNaN,
      float.floatExp,
      float.float
    ];
    exports2.schema = schema;
  }
});

// ../node_modules/yaml/dist/schema/json/schema.js
var require_schema2 = __commonJS({
  "../node_modules/yaml/dist/schema/json/schema.js"(exports2) {
    "use strict";
    var Scalar = require_Scalar();
    var map = require_map();
    var seq = require_seq();
    function intIdentify(value) {
      return typeof value === "bigint" || Number.isInteger(value);
    }
    var stringifyJSON = ({ value }) => JSON.stringify(value);
    var jsonScalars = [
      {
        identify: (value) => typeof value === "string",
        default: true,
        tag: "tag:yaml.org,2002:str",
        resolve: (str) => str,
        stringify: stringifyJSON
      },
      {
        identify: (value) => value == null,
        createNode: () => new Scalar.Scalar(null),
        default: true,
        tag: "tag:yaml.org,2002:null",
        test: /^null$/,
        resolve: () => null,
        stringify: stringifyJSON
      },
      {
        identify: (value) => typeof value === "boolean",
        default: true,
        tag: "tag:yaml.org,2002:bool",
        test: /^true$|^false$/,
        resolve: (str) => str === "true",
        stringify: stringifyJSON
      },
      {
        identify: intIdentify,
        default: true,
        tag: "tag:yaml.org,2002:int",
        test: /^-?(?:0|[1-9][0-9]*)$/,
        resolve: (str, _onError, { intAsBigInt }) => intAsBigInt ? BigInt(str) : parseInt(str, 10),
        stringify: ({ value }) => intIdentify(value) ? value.toString() : JSON.stringify(value)
      },
      {
        identify: (value) => typeof value === "number",
        default: true,
        tag: "tag:yaml.org,2002:float",
        test: /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]*)?(?:[eE][-+]?[0-9]+)?$/,
        resolve: (str) => parseFloat(str),
        stringify: stringifyJSON
      }
    ];
    var jsonError = {
      default: true,
      tag: "",
      test: /^/,
      resolve(str, onError) {
        onError(`Unresolved plain scalar ${JSON.stringify(str)}`);
        return str;
      }
    };
    var schema = [map.map, seq.seq].concat(jsonScalars, jsonError);
    exports2.schema = schema;
  }
});

// ../node_modules/yaml/dist/schema/yaml-1.1/binary.js
var require_binary = __commonJS({
  "../node_modules/yaml/dist/schema/yaml-1.1/binary.js"(exports2) {
    "use strict";
    var node_buffer = require("buffer");
    var Scalar = require_Scalar();
    var stringifyString = require_stringifyString();
    var binary = {
      identify: (value) => value instanceof Uint8Array,
      // Buffer inherits from Uint8Array
      default: false,
      tag: "tag:yaml.org,2002:binary",
      /**
       * Returns a Buffer in node and an Uint8Array in browsers
       *
       * To use the resulting buffer as an image, you'll want to do something like:
       *
       *   const blob = new Blob([buffer], { type: 'image/jpeg' })
       *   document.querySelector('#photo').src = URL.createObjectURL(blob)
       */
      resolve(src, onError) {
        if (typeof node_buffer.Buffer === "function") {
          return node_buffer.Buffer.from(src, "base64");
        } else if (typeof atob === "function") {
          const str = atob(src.replace(/[\n\r]/g, ""));
          const buffer = new Uint8Array(str.length);
          for (let i = 0; i < str.length; ++i)
            buffer[i] = str.charCodeAt(i);
          return buffer;
        } else {
          onError("This environment does not support reading binary tags; either Buffer or atob is required");
          return src;
        }
      },
      stringify({ comment, type, value }, ctx, onComment, onChompKeep) {
        if (!value)
          return "";
        const buf = value;
        let str;
        if (typeof node_buffer.Buffer === "function") {
          str = buf instanceof node_buffer.Buffer ? buf.toString("base64") : node_buffer.Buffer.from(buf.buffer).toString("base64");
        } else if (typeof btoa === "function") {
          let s = "";
          for (let i = 0; i < buf.length; ++i)
            s += String.fromCharCode(buf[i]);
          str = btoa(s);
        } else {
          throw new Error("This environment does not support writing binary tags; either Buffer or btoa is required");
        }
        type ?? (type = Scalar.Scalar.BLOCK_LITERAL);
        if (type !== Scalar.Scalar.QUOTE_DOUBLE) {
          const lineWidth = Math.max(ctx.options.lineWidth - ctx.indent.length, ctx.options.minContentWidth);
          const n = Math.ceil(str.length / lineWidth);
          const lines = new Array(n);
          for (let i = 0, o = 0; i < n; ++i, o += lineWidth) {
            lines[i] = str.substr(o, lineWidth);
          }
          str = lines.join(type === Scalar.Scalar.BLOCK_LITERAL ? "\n" : " ");
        }
        return stringifyString.stringifyString({ comment, type, value: str }, ctx, onComment, onChompKeep);
      }
    };
    exports2.binary = binary;
  }
});

// ../node_modules/yaml/dist/schema/yaml-1.1/pairs.js
var require_pairs = __commonJS({
  "../node_modules/yaml/dist/schema/yaml-1.1/pairs.js"(exports2) {
    "use strict";
    var identity = require_identity();
    var Pair = require_Pair();
    var Scalar = require_Scalar();
    var YAMLSeq = require_YAMLSeq();
    function resolvePairs(seq, onError) {
      if (identity.isSeq(seq)) {
        for (let i = 0; i < seq.items.length; ++i) {
          let item = seq.items[i];
          if (identity.isPair(item))
            continue;
          else if (identity.isMap(item)) {
            if (item.items.length > 1)
              onError("Each pair must have its own sequence indicator");
            const pair = item.items[0] || new Pair.Pair(new Scalar.Scalar(null));
            if (item.commentBefore)
              pair.key.commentBefore = pair.key.commentBefore ? `${item.commentBefore}
${pair.key.commentBefore}` : item.commentBefore;
            if (item.comment) {
              const cn = pair.value ?? pair.key;
              cn.comment = cn.comment ? `${item.comment}
${cn.comment}` : item.comment;
            }
            item = pair;
          }
          seq.items[i] = identity.isPair(item) ? item : new Pair.Pair(item);
        }
      } else
        onError("Expected a sequence for this tag");
      return seq;
    }
    function createPairs(schema, iterable, ctx) {
      const { replacer } = ctx;
      const pairs2 = new YAMLSeq.YAMLSeq(schema);
      pairs2.tag = "tag:yaml.org,2002:pairs";
      let i = 0;
      if (iterable && Symbol.iterator in Object(iterable))
        for (let it of iterable) {
          if (typeof replacer === "function")
            it = replacer.call(iterable, String(i++), it);
          let key, value;
          if (Array.isArray(it)) {
            if (it.length === 2) {
              key = it[0];
              value = it[1];
            } else
              throw new TypeError(`Expected [key, value] tuple: ${it}`);
          } else if (it && it instanceof Object) {
            const keys = Object.keys(it);
            if (keys.length === 1) {
              key = keys[0];
              value = it[key];
            } else {
              throw new TypeError(`Expected tuple with one key, not ${keys.length} keys`);
            }
          } else {
            key = it;
          }
          pairs2.items.push(Pair.createPair(key, value, ctx));
        }
      return pairs2;
    }
    var pairs = {
      collection: "seq",
      default: false,
      tag: "tag:yaml.org,2002:pairs",
      resolve: resolvePairs,
      createNode: createPairs
    };
    exports2.createPairs = createPairs;
    exports2.pairs = pairs;
    exports2.resolvePairs = resolvePairs;
  }
});

// ../node_modules/yaml/dist/schema/yaml-1.1/omap.js
var require_omap = __commonJS({
  "../node_modules/yaml/dist/schema/yaml-1.1/omap.js"(exports2) {
    "use strict";
    var identity = require_identity();
    var toJS = require_toJS();
    var YAMLMap = require_YAMLMap();
    var YAMLSeq = require_YAMLSeq();
    var pairs = require_pairs();
    var YAMLOMap = class _YAMLOMap extends YAMLSeq.YAMLSeq {
      constructor() {
        super();
        this.add = YAMLMap.YAMLMap.prototype.add.bind(this);
        this.delete = YAMLMap.YAMLMap.prototype.delete.bind(this);
        this.get = YAMLMap.YAMLMap.prototype.get.bind(this);
        this.has = YAMLMap.YAMLMap.prototype.has.bind(this);
        this.set = YAMLMap.YAMLMap.prototype.set.bind(this);
        this.tag = _YAMLOMap.tag;
      }
      /**
       * If `ctx` is given, the return type is actually `Map<unknown, unknown>`,
       * but TypeScript won't allow widening the signature of a child method.
       */
      toJSON(_, ctx) {
        if (!ctx)
          return super.toJSON(_);
        const map = /* @__PURE__ */ new Map();
        if (ctx?.onCreate)
          ctx.onCreate(map);
        for (const pair of this.items) {
          let key, value;
          if (identity.isPair(pair)) {
            key = toJS.toJS(pair.key, "", ctx);
            value = toJS.toJS(pair.value, key, ctx);
          } else {
            key = toJS.toJS(pair, "", ctx);
          }
          if (map.has(key))
            throw new Error("Ordered maps must not include duplicate keys");
          map.set(key, value);
        }
        return map;
      }
      static from(schema, iterable, ctx) {
        const pairs$1 = pairs.createPairs(schema, iterable, ctx);
        const omap2 = new this();
        omap2.items = pairs$1.items;
        return omap2;
      }
    };
    YAMLOMap.tag = "tag:yaml.org,2002:omap";
    var omap = {
      collection: "seq",
      identify: (value) => value instanceof Map,
      nodeClass: YAMLOMap,
      default: false,
      tag: "tag:yaml.org,2002:omap",
      resolve(seq, onError) {
        const pairs$1 = pairs.resolvePairs(seq, onError);
        const seenKeys = [];
        for (const { key } of pairs$1.items) {
          if (identity.isScalar(key)) {
            if (seenKeys.includes(key.value)) {
              onError(`Ordered maps must not include duplicate keys: ${key.value}`);
            } else {
              seenKeys.push(key.value);
            }
          }
        }
        return Object.assign(new YAMLOMap(), pairs$1);
      },
      createNode: (schema, iterable, ctx) => YAMLOMap.from(schema, iterable, ctx)
    };
    exports2.YAMLOMap = YAMLOMap;
    exports2.omap = omap;
  }
});

// ../node_modules/yaml/dist/schema/yaml-1.1/bool.js
var require_bool2 = __commonJS({
  "../node_modules/yaml/dist/schema/yaml-1.1/bool.js"(exports2) {
    "use strict";
    var Scalar = require_Scalar();
    function boolStringify({ value, source }, ctx) {
      const boolObj = value ? trueTag : falseTag;
      if (source && boolObj.test.test(source))
        return source;
      return value ? ctx.options.trueStr : ctx.options.falseStr;
    }
    var trueTag = {
      identify: (value) => value === true,
      default: true,
      tag: "tag:yaml.org,2002:bool",
      test: /^(?:Y|y|[Yy]es|YES|[Tt]rue|TRUE|[Oo]n|ON)$/,
      resolve: () => new Scalar.Scalar(true),
      stringify: boolStringify
    };
    var falseTag = {
      identify: (value) => value === false,
      default: true,
      tag: "tag:yaml.org,2002:bool",
      test: /^(?:N|n|[Nn]o|NO|[Ff]alse|FALSE|[Oo]ff|OFF)$/,
      resolve: () => new Scalar.Scalar(false),
      stringify: boolStringify
    };
    exports2.falseTag = falseTag;
    exports2.trueTag = trueTag;
  }
});

// ../node_modules/yaml/dist/schema/yaml-1.1/float.js
var require_float2 = __commonJS({
  "../node_modules/yaml/dist/schema/yaml-1.1/float.js"(exports2) {
    "use strict";
    var Scalar = require_Scalar();
    var stringifyNumber = require_stringifyNumber();
    var floatNaN = {
      identify: (value) => typeof value === "number",
      default: true,
      tag: "tag:yaml.org,2002:float",
      test: /^(?:[-+]?\.(?:inf|Inf|INF)|\.nan|\.NaN|\.NAN)$/,
      resolve: (str) => str.slice(-3).toLowerCase() === "nan" ? NaN : str[0] === "-" ? Number.NEGATIVE_INFINITY : Number.POSITIVE_INFINITY,
      stringify: stringifyNumber.stringifyNumber
    };
    var floatExp = {
      identify: (value) => typeof value === "number",
      default: true,
      tag: "tag:yaml.org,2002:float",
      format: "EXP",
      test: /^[-+]?(?:[0-9][0-9_]*)?(?:\.[0-9_]*)?[eE][-+]?[0-9]+$/,
      resolve: (str) => parseFloat(str.replace(/_/g, "")),
      stringify(node) {
        const num2 = Number(node.value);
        return isFinite(num2) ? num2.toExponential() : stringifyNumber.stringifyNumber(node);
      }
    };
    var float = {
      identify: (value) => typeof value === "number",
      default: true,
      tag: "tag:yaml.org,2002:float",
      test: /^[-+]?(?:[0-9][0-9_]*)?\.[0-9_]*$/,
      resolve(str) {
        const node = new Scalar.Scalar(parseFloat(str.replace(/_/g, "")));
        const dot = str.indexOf(".");
        if (dot !== -1) {
          const f = str.substring(dot + 1).replace(/_/g, "");
          if (f[f.length - 1] === "0")
            node.minFractionDigits = f.length;
        }
        return node;
      },
      stringify: stringifyNumber.stringifyNumber
    };
    exports2.float = float;
    exports2.floatExp = floatExp;
    exports2.floatNaN = floatNaN;
  }
});

// ../node_modules/yaml/dist/schema/yaml-1.1/int.js
var require_int2 = __commonJS({
  "../node_modules/yaml/dist/schema/yaml-1.1/int.js"(exports2) {
    "use strict";
    var stringifyNumber = require_stringifyNumber();
    var intIdentify = (value) => typeof value === "bigint" || Number.isInteger(value);
    function intResolve(str, offset, radix, { intAsBigInt }) {
      const sign = str[0];
      if (sign === "-" || sign === "+")
        offset += 1;
      str = str.substring(offset).replace(/_/g, "");
      if (intAsBigInt) {
        switch (radix) {
          case 2:
            str = `0b${str}`;
            break;
          case 8:
            str = `0o${str}`;
            break;
          case 16:
            str = `0x${str}`;
            break;
        }
        const n2 = BigInt(str);
        return sign === "-" ? BigInt(-1) * n2 : n2;
      }
      const n = parseInt(str, radix);
      return sign === "-" ? -1 * n : n;
    }
    function intStringify(node, radix, prefix) {
      const { value } = node;
      if (intIdentify(value)) {
        const str = value.toString(radix);
        return value < 0 ? "-" + prefix + str.substr(1) : prefix + str;
      }
      return stringifyNumber.stringifyNumber(node);
    }
    var intBin = {
      identify: intIdentify,
      default: true,
      tag: "tag:yaml.org,2002:int",
      format: "BIN",
      test: /^[-+]?0b[0-1_]+$/,
      resolve: (str, _onError, opt) => intResolve(str, 2, 2, opt),
      stringify: (node) => intStringify(node, 2, "0b")
    };
    var intOct = {
      identify: intIdentify,
      default: true,
      tag: "tag:yaml.org,2002:int",
      format: "OCT",
      test: /^[-+]?0[0-7_]+$/,
      resolve: (str, _onError, opt) => intResolve(str, 1, 8, opt),
      stringify: (node) => intStringify(node, 8, "0")
    };
    var int = {
      identify: intIdentify,
      default: true,
      tag: "tag:yaml.org,2002:int",
      test: /^[-+]?[0-9][0-9_]*$/,
      resolve: (str, _onError, opt) => intResolve(str, 0, 10, opt),
      stringify: stringifyNumber.stringifyNumber
    };
    var intHex = {
      identify: intIdentify,
      default: true,
      tag: "tag:yaml.org,2002:int",
      format: "HEX",
      test: /^[-+]?0x[0-9a-fA-F_]+$/,
      resolve: (str, _onError, opt) => intResolve(str, 2, 16, opt),
      stringify: (node) => intStringify(node, 16, "0x")
    };
    exports2.int = int;
    exports2.intBin = intBin;
    exports2.intHex = intHex;
    exports2.intOct = intOct;
  }
});

// ../node_modules/yaml/dist/schema/yaml-1.1/set.js
var require_set = __commonJS({
  "../node_modules/yaml/dist/schema/yaml-1.1/set.js"(exports2) {
    "use strict";
    var identity = require_identity();
    var Pair = require_Pair();
    var YAMLMap = require_YAMLMap();
    var YAMLSet = class _YAMLSet extends YAMLMap.YAMLMap {
      constructor(schema) {
        super(schema);
        this.tag = _YAMLSet.tag;
      }
      add(key) {
        let pair;
        if (identity.isPair(key))
          pair = key;
        else if (key && typeof key === "object" && "key" in key && "value" in key && key.value === null)
          pair = new Pair.Pair(key.key, null);
        else
          pair = new Pair.Pair(key, null);
        const prev = YAMLMap.findPair(this.items, pair.key);
        if (!prev)
          this.items.push(pair);
      }
      /**
       * If `keepPair` is `true`, returns the Pair matching `key`.
       * Otherwise, returns the value of that Pair's key.
       */
      get(key, keepPair) {
        const pair = YAMLMap.findPair(this.items, key);
        return !keepPair && identity.isPair(pair) ? identity.isScalar(pair.key) ? pair.key.value : pair.key : pair;
      }
      set(key, value) {
        if (typeof value !== "boolean")
          throw new Error(`Expected boolean value for set(key, value) in a YAML set, not ${typeof value}`);
        const prev = YAMLMap.findPair(this.items, key);
        if (prev && !value) {
          this.items.splice(this.items.indexOf(prev), 1);
        } else if (!prev && value) {
          this.items.push(new Pair.Pair(key));
        }
      }
      toJSON(_, ctx) {
        return super.toJSON(_, ctx, Set);
      }
      toString(ctx, onComment, onChompKeep) {
        if (!ctx)
          return JSON.stringify(this);
        if (this.hasAllNullValues(true))
          return super.toString(Object.assign({}, ctx, { allNullValues: true }), onComment, onChompKeep);
        else
          throw new Error("Set items must all have null values");
      }
      static from(schema, iterable, ctx) {
        const { replacer } = ctx;
        const set2 = new this(schema);
        if (iterable && Symbol.iterator in Object(iterable))
          for (let value of iterable) {
            if (typeof replacer === "function")
              value = replacer.call(iterable, value, value);
            set2.items.push(Pair.createPair(value, null, ctx));
          }
        return set2;
      }
    };
    YAMLSet.tag = "tag:yaml.org,2002:set";
    var set = {
      collection: "map",
      identify: (value) => value instanceof Set,
      nodeClass: YAMLSet,
      default: false,
      tag: "tag:yaml.org,2002:set",
      createNode: (schema, iterable, ctx) => YAMLSet.from(schema, iterable, ctx),
      resolve(map, onError) {
        if (identity.isMap(map)) {
          if (map.hasAllNullValues(true))
            return Object.assign(new YAMLSet(), map);
          else
            onError("Set items must all have null values");
        } else
          onError("Expected a mapping for this tag");
        return map;
      }
    };
    exports2.YAMLSet = YAMLSet;
    exports2.set = set;
  }
});

// ../node_modules/yaml/dist/schema/yaml-1.1/timestamp.js
var require_timestamp = __commonJS({
  "../node_modules/yaml/dist/schema/yaml-1.1/timestamp.js"(exports2) {
    "use strict";
    var stringifyNumber = require_stringifyNumber();
    function parseSexagesimal(str, asBigInt) {
      const sign = str[0];
      const parts = sign === "-" || sign === "+" ? str.substring(1) : str;
      const num2 = (n) => asBigInt ? BigInt(n) : Number(n);
      const res = parts.replace(/_/g, "").split(":").reduce((res2, p) => res2 * num2(60) + num2(p), num2(0));
      return sign === "-" ? num2(-1) * res : res;
    }
    function stringifySexagesimal(node) {
      let { value } = node;
      let num2 = (n) => n;
      if (typeof value === "bigint")
        num2 = (n) => BigInt(n);
      else if (isNaN(value) || !isFinite(value))
        return stringifyNumber.stringifyNumber(node);
      let sign = "";
      if (value < 0) {
        sign = "-";
        value *= num2(-1);
      }
      const _60 = num2(60);
      const parts = [value % _60];
      if (value < 60) {
        parts.unshift(0);
      } else {
        value = (value - parts[0]) / _60;
        parts.unshift(value % _60);
        if (value >= 60) {
          value = (value - parts[0]) / _60;
          parts.unshift(value);
        }
      }
      return sign + parts.map((n) => String(n).padStart(2, "0")).join(":").replace(/000000\d*$/, "");
    }
    var intTime = {
      identify: (value) => typeof value === "bigint" || Number.isInteger(value),
      default: true,
      tag: "tag:yaml.org,2002:int",
      format: "TIME",
      test: /^[-+]?[0-9][0-9_]*(?::[0-5]?[0-9])+$/,
      resolve: (str, _onError, { intAsBigInt }) => parseSexagesimal(str, intAsBigInt),
      stringify: stringifySexagesimal
    };
    var floatTime = {
      identify: (value) => typeof value === "number",
      default: true,
      tag: "tag:yaml.org,2002:float",
      format: "TIME",
      test: /^[-+]?[0-9][0-9_]*(?::[0-5]?[0-9])+\.[0-9_]*$/,
      resolve: (str) => parseSexagesimal(str, false),
      stringify: stringifySexagesimal
    };
    var timestamp = {
      identify: (value) => value instanceof Date,
      default: true,
      tag: "tag:yaml.org,2002:timestamp",
      // If the time zone is omitted, the timestamp is assumed to be specified in UTC. The time part
      // may be omitted altogether, resulting in a date format. In such a case, the time part is
      // assumed to be 00:00:00Z (start of day, UTC).
      test: RegExp("^([0-9]{4})-([0-9]{1,2})-([0-9]{1,2})(?:(?:t|T|[ \\t]+)([0-9]{1,2}):([0-9]{1,2}):([0-9]{1,2}(\\.[0-9]+)?)(?:[ \\t]*(Z|[-+][012]?[0-9](?::[0-9]{2})?))?)?$"),
      resolve(str) {
        const match = str.match(timestamp.test);
        if (!match)
          throw new Error("!!timestamp expects a date, starting with yyyy-mm-dd");
        const [, year, month, day, hour, minute, second] = match.map(Number);
        const millisec = match[7] ? Number((match[7] + "00").substr(1, 3)) : 0;
        let date = Date.UTC(year, month - 1, day, hour || 0, minute || 0, second || 0, millisec);
        const tz = match[8];
        if (tz && tz !== "Z") {
          let d = parseSexagesimal(tz, false);
          if (Math.abs(d) < 30)
            d *= 60;
          date -= 6e4 * d;
        }
        return new Date(date);
      },
      stringify: ({ value }) => value?.toISOString().replace(/(T00:00:00)?\.000Z$/, "") ?? ""
    };
    exports2.floatTime = floatTime;
    exports2.intTime = intTime;
    exports2.timestamp = timestamp;
  }
});

// ../node_modules/yaml/dist/schema/yaml-1.1/schema.js
var require_schema3 = __commonJS({
  "../node_modules/yaml/dist/schema/yaml-1.1/schema.js"(exports2) {
    "use strict";
    var map = require_map();
    var _null = require_null();
    var seq = require_seq();
    var string = require_string();
    var binary = require_binary();
    var bool = require_bool2();
    var float = require_float2();
    var int = require_int2();
    var merge = require_merge();
    var omap = require_omap();
    var pairs = require_pairs();
    var set = require_set();
    var timestamp = require_timestamp();
    var schema = [
      map.map,
      seq.seq,
      string.string,
      _null.nullTag,
      bool.trueTag,
      bool.falseTag,
      int.intBin,
      int.intOct,
      int.int,
      int.intHex,
      float.floatNaN,
      float.floatExp,
      float.float,
      binary.binary,
      merge.merge,
      omap.omap,
      pairs.pairs,
      set.set,
      timestamp.intTime,
      timestamp.floatTime,
      timestamp.timestamp
    ];
    exports2.schema = schema;
  }
});

// ../node_modules/yaml/dist/schema/tags.js
var require_tags = __commonJS({
  "../node_modules/yaml/dist/schema/tags.js"(exports2) {
    "use strict";
    var map = require_map();
    var _null = require_null();
    var seq = require_seq();
    var string = require_string();
    var bool = require_bool();
    var float = require_float();
    var int = require_int();
    var schema = require_schema();
    var schema$1 = require_schema2();
    var binary = require_binary();
    var merge = require_merge();
    var omap = require_omap();
    var pairs = require_pairs();
    var schema$2 = require_schema3();
    var set = require_set();
    var timestamp = require_timestamp();
    var schemas = /* @__PURE__ */ new Map([
      ["core", schema.schema],
      ["failsafe", [map.map, seq.seq, string.string]],
      ["json", schema$1.schema],
      ["yaml11", schema$2.schema],
      ["yaml-1.1", schema$2.schema]
    ]);
    var tagsByName = {
      binary: binary.binary,
      bool: bool.boolTag,
      float: float.float,
      floatExp: float.floatExp,
      floatNaN: float.floatNaN,
      floatTime: timestamp.floatTime,
      int: int.int,
      intHex: int.intHex,
      intOct: int.intOct,
      intTime: timestamp.intTime,
      map: map.map,
      merge: merge.merge,
      null: _null.nullTag,
      omap: omap.omap,
      pairs: pairs.pairs,
      seq: seq.seq,
      set: set.set,
      timestamp: timestamp.timestamp
    };
    var coreKnownTags = {
      "tag:yaml.org,2002:binary": binary.binary,
      "tag:yaml.org,2002:merge": merge.merge,
      "tag:yaml.org,2002:omap": omap.omap,
      "tag:yaml.org,2002:pairs": pairs.pairs,
      "tag:yaml.org,2002:set": set.set,
      "tag:yaml.org,2002:timestamp": timestamp.timestamp
    };
    function getTags(customTags, schemaName, addMergeTag) {
      const schemaTags = schemas.get(schemaName);
      if (schemaTags && !customTags) {
        return addMergeTag && !schemaTags.includes(merge.merge) ? schemaTags.concat(merge.merge) : schemaTags.slice();
      }
      let tags = schemaTags;
      if (!tags) {
        if (Array.isArray(customTags))
          tags = [];
        else {
          const keys = Array.from(schemas.keys()).filter((key) => key !== "yaml11").map((key) => JSON.stringify(key)).join(", ");
          throw new Error(`Unknown schema "${schemaName}"; use one of ${keys} or define customTags array`);
        }
      }
      if (Array.isArray(customTags)) {
        for (const tag of customTags)
          tags = tags.concat(tag);
      } else if (typeof customTags === "function") {
        tags = customTags(tags.slice());
      }
      if (addMergeTag)
        tags = tags.concat(merge.merge);
      return tags.reduce((tags2, tag) => {
        const tagObj = typeof tag === "string" ? tagsByName[tag] : tag;
        if (!tagObj) {
          const tagName = JSON.stringify(tag);
          const keys = Object.keys(tagsByName).map((key) => JSON.stringify(key)).join(", ");
          throw new Error(`Unknown custom tag ${tagName}; use one of ${keys}`);
        }
        if (!tags2.includes(tagObj))
          tags2.push(tagObj);
        return tags2;
      }, []);
    }
    exports2.coreKnownTags = coreKnownTags;
    exports2.getTags = getTags;
  }
});

// ../node_modules/yaml/dist/schema/Schema.js
var require_Schema = __commonJS({
  "../node_modules/yaml/dist/schema/Schema.js"(exports2) {
    "use strict";
    var identity = require_identity();
    var map = require_map();
    var seq = require_seq();
    var string = require_string();
    var tags = require_tags();
    var sortMapEntriesByKey = (a, b) => a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
    var Schema = class _Schema {
      constructor({ compat, customTags, merge, resolveKnownTags, schema, sortMapEntries, toStringDefaults }) {
        this.compat = Array.isArray(compat) ? tags.getTags(compat, "compat") : compat ? tags.getTags(null, compat) : null;
        this.name = typeof schema === "string" && schema || "core";
        this.knownTags = resolveKnownTags ? tags.coreKnownTags : {};
        this.tags = tags.getTags(customTags, this.name, merge);
        this.toStringOptions = toStringDefaults ?? null;
        Object.defineProperty(this, identity.MAP, { value: map.map });
        Object.defineProperty(this, identity.SCALAR, { value: string.string });
        Object.defineProperty(this, identity.SEQ, { value: seq.seq });
        this.sortMapEntries = typeof sortMapEntries === "function" ? sortMapEntries : sortMapEntries === true ? sortMapEntriesByKey : null;
      }
      clone() {
        const copy = Object.create(_Schema.prototype, Object.getOwnPropertyDescriptors(this));
        copy.tags = this.tags.slice();
        return copy;
      }
    };
    exports2.Schema = Schema;
  }
});

// ../node_modules/yaml/dist/stringify/stringifyDocument.js
var require_stringifyDocument = __commonJS({
  "../node_modules/yaml/dist/stringify/stringifyDocument.js"(exports2) {
    "use strict";
    var identity = require_identity();
    var stringify = require_stringify();
    var stringifyComment = require_stringifyComment();
    function stringifyDocument(doc, options) {
      const lines = [];
      let hasDirectives = options.directives === true;
      if (options.directives !== false && doc.directives) {
        const dir = doc.directives.toString(doc);
        if (dir) {
          lines.push(dir);
          hasDirectives = true;
        } else if (doc.directives.docStart)
          hasDirectives = true;
      }
      if (hasDirectives)
        lines.push("---");
      const ctx = stringify.createStringifyContext(doc, options);
      const { commentString } = ctx.options;
      if (doc.commentBefore) {
        if (lines.length !== 1)
          lines.unshift("");
        const cs = commentString(doc.commentBefore);
        lines.unshift(stringifyComment.indentComment(cs, ""));
      }
      let chompKeep = false;
      let contentComment = null;
      if (doc.contents) {
        if (identity.isNode(doc.contents)) {
          if (doc.contents.spaceBefore && hasDirectives)
            lines.push("");
          if (doc.contents.commentBefore) {
            const cs = commentString(doc.contents.commentBefore);
            lines.push(stringifyComment.indentComment(cs, ""));
          }
          ctx.forceBlockIndent = !!doc.comment;
          contentComment = doc.contents.comment;
        }
        const onChompKeep = contentComment ? void 0 : () => chompKeep = true;
        let body = stringify.stringify(doc.contents, ctx, () => contentComment = null, onChompKeep);
        if (contentComment)
          body += stringifyComment.lineComment(body, "", commentString(contentComment));
        if ((body[0] === "|" || body[0] === ">") && lines[lines.length - 1] === "---") {
          lines[lines.length - 1] = `--- ${body}`;
        } else
          lines.push(body);
      } else {
        lines.push(stringify.stringify(doc.contents, ctx));
      }
      if (doc.directives?.docEnd) {
        if (doc.comment) {
          const cs = commentString(doc.comment);
          if (cs.includes("\n")) {
            lines.push("...");
            lines.push(stringifyComment.indentComment(cs, ""));
          } else {
            lines.push(`... ${cs}`);
          }
        } else {
          lines.push("...");
        }
      } else {
        let dc = doc.comment;
        if (dc && chompKeep)
          dc = dc.replace(/^\n+/, "");
        if (dc) {
          if ((!chompKeep || contentComment) && lines[lines.length - 1] !== "")
            lines.push("");
          lines.push(stringifyComment.indentComment(commentString(dc), ""));
        }
      }
      return lines.join("\n") + "\n";
    }
    exports2.stringifyDocument = stringifyDocument;
  }
});

// ../node_modules/yaml/dist/doc/Document.js
var require_Document = __commonJS({
  "../node_modules/yaml/dist/doc/Document.js"(exports2) {
    "use strict";
    var Alias = require_Alias();
    var Collection = require_Collection();
    var identity = require_identity();
    var Pair = require_Pair();
    var toJS = require_toJS();
    var Schema = require_Schema();
    var stringifyDocument = require_stringifyDocument();
    var anchors = require_anchors();
    var applyReviver = require_applyReviver();
    var createNode = require_createNode();
    var directives = require_directives();
    var Document = class _Document {
      constructor(value, replacer, options) {
        this.commentBefore = null;
        this.comment = null;
        this.errors = [];
        this.warnings = [];
        Object.defineProperty(this, identity.NODE_TYPE, { value: identity.DOC });
        let _replacer = null;
        if (typeof replacer === "function" || Array.isArray(replacer)) {
          _replacer = replacer;
        } else if (options === void 0 && replacer) {
          options = replacer;
          replacer = void 0;
        }
        const opt = Object.assign({
          intAsBigInt: false,
          keepSourceTokens: false,
          logLevel: "warn",
          prettyErrors: true,
          strict: true,
          stringKeys: false,
          uniqueKeys: true,
          version: "1.2"
        }, options);
        this.options = opt;
        let { version } = opt;
        if (options?._directives) {
          this.directives = options._directives.atDocument();
          if (this.directives.yaml.explicit)
            version = this.directives.yaml.version;
        } else
          this.directives = new directives.Directives({ version });
        this.setSchema(version, options);
        this.contents = value === void 0 ? null : this.createNode(value, _replacer, options);
      }
      /**
       * Create a deep copy of this Document and its contents.
       *
       * Custom Node values that inherit from `Object` still refer to their original instances.
       */
      clone() {
        const copy = Object.create(_Document.prototype, {
          [identity.NODE_TYPE]: { value: identity.DOC }
        });
        copy.commentBefore = this.commentBefore;
        copy.comment = this.comment;
        copy.errors = this.errors.slice();
        copy.warnings = this.warnings.slice();
        copy.options = Object.assign({}, this.options);
        if (this.directives)
          copy.directives = this.directives.clone();
        copy.schema = this.schema.clone();
        copy.contents = identity.isNode(this.contents) ? this.contents.clone(copy.schema) : this.contents;
        if (this.range)
          copy.range = this.range.slice();
        return copy;
      }
      /** Adds a value to the document. */
      add(value) {
        if (assertCollection(this.contents))
          this.contents.add(value);
      }
      /** Adds a value to the document. */
      addIn(path, value) {
        if (assertCollection(this.contents))
          this.contents.addIn(path, value);
      }
      /**
       * Create a new `Alias` node, ensuring that the target `node` has the required anchor.
       *
       * If `node` already has an anchor, `name` is ignored.
       * Otherwise, the `node.anchor` value will be set to `name`,
       * or if an anchor with that name is already present in the document,
       * `name` will be used as a prefix for a new unique anchor.
       * If `name` is undefined, the generated anchor will use 'a' as a prefix.
       */
      createAlias(node, name) {
        if (!node.anchor) {
          const prev = anchors.anchorNames(this);
          node.anchor = // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing
          !name || prev.has(name) ? anchors.findNewAnchor(name || "a", prev) : name;
        }
        return new Alias.Alias(node.anchor);
      }
      createNode(value, replacer, options) {
        let _replacer = void 0;
        if (typeof replacer === "function") {
          value = replacer.call({ "": value }, "", value);
          _replacer = replacer;
        } else if (Array.isArray(replacer)) {
          const keyToStr = (v) => typeof v === "number" || v instanceof String || v instanceof Number;
          const asStr = replacer.filter(keyToStr).map(String);
          if (asStr.length > 0)
            replacer = replacer.concat(asStr);
          _replacer = replacer;
        } else if (options === void 0 && replacer) {
          options = replacer;
          replacer = void 0;
        }
        const { aliasDuplicateObjects, anchorPrefix, flow, keepUndefined, onTagObj, tag } = options ?? {};
        const { onAnchor, setAnchors, sourceObjects } = anchors.createNodeAnchors(
          this,
          // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing
          anchorPrefix || "a"
        );
        const ctx = {
          aliasDuplicateObjects: aliasDuplicateObjects ?? true,
          keepUndefined: keepUndefined ?? false,
          onAnchor,
          onTagObj,
          replacer: _replacer,
          schema: this.schema,
          sourceObjects
        };
        const node = createNode.createNode(value, tag, ctx);
        if (flow && identity.isCollection(node))
          node.flow = true;
        setAnchors();
        return node;
      }
      /**
       * Convert a key and a value into a `Pair` using the current schema,
       * recursively wrapping all values as `Scalar` or `Collection` nodes.
       */
      createPair(key, value, options = {}) {
        const k = this.createNode(key, null, options);
        const v = this.createNode(value, null, options);
        return new Pair.Pair(k, v);
      }
      /**
       * Removes a value from the document.
       * @returns `true` if the item was found and removed.
       */
      delete(key) {
        return assertCollection(this.contents) ? this.contents.delete(key) : false;
      }
      /**
       * Removes a value from the document.
       * @returns `true` if the item was found and removed.
       */
      deleteIn(path) {
        if (Collection.isEmptyPath(path)) {
          if (this.contents == null)
            return false;
          this.contents = null;
          return true;
        }
        return assertCollection(this.contents) ? this.contents.deleteIn(path) : false;
      }
      /**
       * Returns item at `key`, or `undefined` if not found. By default unwraps
       * scalar values from their surrounding node; to disable set `keepScalar` to
       * `true` (collections are always returned intact).
       */
      get(key, keepScalar) {
        return identity.isCollection(this.contents) ? this.contents.get(key, keepScalar) : void 0;
      }
      /**
       * Returns item at `path`, or `undefined` if not found. By default unwraps
       * scalar values from their surrounding node; to disable set `keepScalar` to
       * `true` (collections are always returned intact).
       */
      getIn(path, keepScalar) {
        if (Collection.isEmptyPath(path))
          return !keepScalar && identity.isScalar(this.contents) ? this.contents.value : this.contents;
        return identity.isCollection(this.contents) ? this.contents.getIn(path, keepScalar) : void 0;
      }
      /**
       * Checks if the document includes a value with the key `key`.
       */
      has(key) {
        return identity.isCollection(this.contents) ? this.contents.has(key) : false;
      }
      /**
       * Checks if the document includes a value at `path`.
       */
      hasIn(path) {
        if (Collection.isEmptyPath(path))
          return this.contents !== void 0;
        return identity.isCollection(this.contents) ? this.contents.hasIn(path) : false;
      }
      /**
       * Sets a value in this document. For `!!set`, `value` needs to be a
       * boolean to add/remove the item from the set.
       */
      set(key, value) {
        if (this.contents == null) {
          this.contents = Collection.collectionFromPath(this.schema, [key], value);
        } else if (assertCollection(this.contents)) {
          this.contents.set(key, value);
        }
      }
      /**
       * Sets a value in this document. For `!!set`, `value` needs to be a
       * boolean to add/remove the item from the set.
       */
      setIn(path, value) {
        if (Collection.isEmptyPath(path)) {
          this.contents = value;
        } else if (this.contents == null) {
          this.contents = Collection.collectionFromPath(this.schema, Array.from(path), value);
        } else if (assertCollection(this.contents)) {
          this.contents.setIn(path, value);
        }
      }
      /**
       * Change the YAML version and schema used by the document.
       * A `null` version disables support for directives, explicit tags, anchors, and aliases.
       * It also requires the `schema` option to be given as a `Schema` instance value.
       *
       * Overrides all previously set schema options.
       */
      setSchema(version, options = {}) {
        if (typeof version === "number")
          version = String(version);
        let opt;
        switch (version) {
          case "1.1":
            if (this.directives)
              this.directives.yaml.version = "1.1";
            else
              this.directives = new directives.Directives({ version: "1.1" });
            opt = { resolveKnownTags: false, schema: "yaml-1.1" };
            break;
          case "1.2":
          case "next":
            if (this.directives)
              this.directives.yaml.version = version;
            else
              this.directives = new directives.Directives({ version });
            opt = { resolveKnownTags: true, schema: "core" };
            break;
          case null:
            if (this.directives)
              delete this.directives;
            opt = null;
            break;
          default: {
            const sv = JSON.stringify(version);
            throw new Error(`Expected '1.1', '1.2' or null as first argument, but found: ${sv}`);
          }
        }
        if (options.schema instanceof Object)
          this.schema = options.schema;
        else if (opt)
          this.schema = new Schema.Schema(Object.assign(opt, options));
        else
          throw new Error(`With a null YAML version, the { schema: Schema } option is required`);
      }
      // json & jsonArg are only used from toJSON()
      toJS({ json, jsonArg, mapAsMap, maxAliasCount, onAnchor, reviver } = {}) {
        const ctx = {
          anchors: /* @__PURE__ */ new Map(),
          doc: this,
          keep: !json,
          mapAsMap: mapAsMap === true,
          mapKeyWarned: false,
          maxAliasCount: typeof maxAliasCount === "number" ? maxAliasCount : 100
        };
        const res = toJS.toJS(this.contents, jsonArg ?? "", ctx);
        if (typeof onAnchor === "function")
          for (const { count, res: res2 } of ctx.anchors.values())
            onAnchor(res2, count);
        return typeof reviver === "function" ? applyReviver.applyReviver(reviver, { "": res }, "", res) : res;
      }
      /**
       * A JSON representation of the document `contents`.
       *
       * @param jsonArg Used by `JSON.stringify` to indicate the array index or
       *   property name.
       */
      toJSON(jsonArg, onAnchor) {
        return this.toJS({ json: true, jsonArg, mapAsMap: false, onAnchor });
      }
      /** A YAML representation of the document. */
      toString(options = {}) {
        if (this.errors.length > 0)
          throw new Error("Document with errors cannot be stringified");
        if ("indent" in options && (!Number.isInteger(options.indent) || Number(options.indent) <= 0)) {
          const s = JSON.stringify(options.indent);
          throw new Error(`"indent" option must be a positive integer, not ${s}`);
        }
        return stringifyDocument.stringifyDocument(this, options);
      }
    };
    function assertCollection(contents) {
      if (identity.isCollection(contents))
        return true;
      throw new Error("Expected a YAML collection as document contents");
    }
    exports2.Document = Document;
  }
});

// ../node_modules/yaml/dist/errors.js
var require_errors = __commonJS({
  "../node_modules/yaml/dist/errors.js"(exports2) {
    "use strict";
    var YAMLError = class extends Error {
      constructor(name, pos, code, message) {
        super();
        this.name = name;
        this.code = code;
        this.message = message;
        this.pos = pos;
      }
    };
    var YAMLParseError = class extends YAMLError {
      constructor(pos, code, message) {
        super("YAMLParseError", pos, code, message);
      }
    };
    var YAMLWarning = class extends YAMLError {
      constructor(pos, code, message) {
        super("YAMLWarning", pos, code, message);
      }
    };
    var prettifyError = (src, lc2) => (error) => {
      if (error.pos[0] === -1)
        return;
      error.linePos = error.pos.map((pos) => lc2.linePos(pos));
      const { line, col } = error.linePos[0];
      error.message += ` at line ${line}, column ${col}`;
      let ci = col - 1;
      let lineStr = src.substring(lc2.lineStarts[line - 1], lc2.lineStarts[line]).replace(/[\n\r]+$/, "");
      if (ci >= 60 && lineStr.length > 80) {
        const trimStart = Math.min(ci - 39, lineStr.length - 79);
        lineStr = "\u2026" + lineStr.substring(trimStart);
        ci -= trimStart - 1;
      }
      if (lineStr.length > 80)
        lineStr = lineStr.substring(0, 79) + "\u2026";
      if (line > 1 && /^ *$/.test(lineStr.substring(0, ci))) {
        let prev = src.substring(lc2.lineStarts[line - 2], lc2.lineStarts[line - 1]);
        if (prev.length > 80)
          prev = prev.substring(0, 79) + "\u2026\n";
        lineStr = prev + lineStr;
      }
      if (/[^ ]/.test(lineStr)) {
        let count = 1;
        const end = error.linePos[1];
        if (end?.line === line && end.col > col) {
          count = Math.max(1, Math.min(end.col - col, 80 - ci));
        }
        const pointer = " ".repeat(ci) + "^".repeat(count);
        error.message += `:

${lineStr}
${pointer}
`;
      }
    };
    exports2.YAMLError = YAMLError;
    exports2.YAMLParseError = YAMLParseError;
    exports2.YAMLWarning = YAMLWarning;
    exports2.prettifyError = prettifyError;
  }
});

// ../node_modules/yaml/dist/compose/resolve-props.js
var require_resolve_props = __commonJS({
  "../node_modules/yaml/dist/compose/resolve-props.js"(exports2) {
    "use strict";
    function resolveProps(tokens, { flow, indicator, next, offset, onError, parentIndent, startOnNewline }) {
      let spaceBefore = false;
      let atNewline = startOnNewline;
      let hasSpace = startOnNewline;
      let comment = "";
      let commentSep = "";
      let hasNewline = false;
      let reqSpace = false;
      let tab = null;
      let anchor = null;
      let tag = null;
      let newlineAfterProp = null;
      let comma = null;
      let found = null;
      let start = null;
      for (const token of tokens) {
        if (reqSpace) {
          if (token.type !== "space" && token.type !== "newline" && token.type !== "comma")
            onError(token.offset, "MISSING_CHAR", "Tags and anchors must be separated from the next token by white space");
          reqSpace = false;
        }
        if (tab) {
          if (atNewline && token.type !== "comment" && token.type !== "newline") {
            onError(tab, "TAB_AS_INDENT", "Tabs are not allowed as indentation");
          }
          tab = null;
        }
        switch (token.type) {
          case "space":
            if (!flow && (indicator !== "doc-start" || next?.type !== "flow-collection") && token.source.includes("	")) {
              tab = token;
            }
            hasSpace = true;
            break;
          case "comment": {
            if (!hasSpace)
              onError(token, "MISSING_CHAR", "Comments must be separated from other tokens by white space characters");
            const cb = token.source.substring(1) || " ";
            if (!comment)
              comment = cb;
            else
              comment += commentSep + cb;
            commentSep = "";
            atNewline = false;
            break;
          }
          case "newline":
            if (atNewline) {
              if (comment)
                comment += token.source;
              else if (!found || indicator !== "seq-item-ind")
                spaceBefore = true;
            } else
              commentSep += token.source;
            atNewline = true;
            hasNewline = true;
            if (anchor || tag)
              newlineAfterProp = token;
            hasSpace = true;
            break;
          case "anchor":
            if (anchor)
              onError(token, "MULTIPLE_ANCHORS", "A node can have at most one anchor");
            if (token.source.endsWith(":"))
              onError(token.offset + token.source.length - 1, "BAD_ALIAS", "Anchor ending in : is ambiguous", true);
            anchor = token;
            start ?? (start = token.offset);
            atNewline = false;
            hasSpace = false;
            reqSpace = true;
            break;
          case "tag": {
            if (tag)
              onError(token, "MULTIPLE_TAGS", "A node can have at most one tag");
            tag = token;
            start ?? (start = token.offset);
            atNewline = false;
            hasSpace = false;
            reqSpace = true;
            break;
          }
          case indicator:
            if (anchor || tag)
              onError(token, "BAD_PROP_ORDER", `Anchors and tags must be after the ${token.source} indicator`);
            if (found)
              onError(token, "UNEXPECTED_TOKEN", `Unexpected ${token.source} in ${flow ?? "collection"}`);
            found = token;
            atNewline = indicator === "seq-item-ind" || indicator === "explicit-key-ind";
            hasSpace = false;
            break;
          case "comma":
            if (flow) {
              if (comma)
                onError(token, "UNEXPECTED_TOKEN", `Unexpected , in ${flow}`);
              comma = token;
              atNewline = false;
              hasSpace = false;
              break;
            }
          // else fallthrough
          default:
            onError(token, "UNEXPECTED_TOKEN", `Unexpected ${token.type} token`);
            atNewline = false;
            hasSpace = false;
        }
      }
      const last = tokens[tokens.length - 1];
      const end = last ? last.offset + last.source.length : offset;
      if (reqSpace && next && next.type !== "space" && next.type !== "newline" && next.type !== "comma" && (next.type !== "scalar" || next.source !== "")) {
        onError(next.offset, "MISSING_CHAR", "Tags and anchors must be separated from the next token by white space");
      }
      if (tab && (atNewline && tab.indent <= parentIndent || next?.type === "block-map" || next?.type === "block-seq"))
        onError(tab, "TAB_AS_INDENT", "Tabs are not allowed as indentation");
      return {
        comma,
        found,
        spaceBefore,
        comment,
        hasNewline,
        anchor,
        tag,
        newlineAfterProp,
        end,
        start: start ?? end
      };
    }
    exports2.resolveProps = resolveProps;
  }
});

// ../node_modules/yaml/dist/compose/util-contains-newline.js
var require_util_contains_newline = __commonJS({
  "../node_modules/yaml/dist/compose/util-contains-newline.js"(exports2) {
    "use strict";
    function containsNewline(key) {
      if (!key)
        return null;
      switch (key.type) {
        case "alias":
        case "scalar":
        case "double-quoted-scalar":
        case "single-quoted-scalar":
          if (key.source.includes("\n"))
            return true;
          if (key.end) {
            for (const st of key.end)
              if (st.type === "newline")
                return true;
          }
          return false;
        case "flow-collection":
          for (const it of key.items) {
            for (const st of it.start)
              if (st.type === "newline")
                return true;
            if (it.sep) {
              for (const st of it.sep)
                if (st.type === "newline")
                  return true;
            }
            if (containsNewline(it.key) || containsNewline(it.value))
              return true;
          }
          return false;
        default:
          return true;
      }
    }
    exports2.containsNewline = containsNewline;
  }
});

// ../node_modules/yaml/dist/compose/util-flow-indent-check.js
var require_util_flow_indent_check = __commonJS({
  "../node_modules/yaml/dist/compose/util-flow-indent-check.js"(exports2) {
    "use strict";
    var utilContainsNewline = require_util_contains_newline();
    function flowIndentCheck(indent, fc, onError) {
      if (fc?.type === "flow-collection") {
        const end = fc.end[0];
        if (end.indent === indent && (end.source === "]" || end.source === "}") && utilContainsNewline.containsNewline(fc)) {
          const msg = "Flow end indicator should be more indented than parent";
          onError(end, "BAD_INDENT", msg, true);
        }
      }
    }
    exports2.flowIndentCheck = flowIndentCheck;
  }
});

// ../node_modules/yaml/dist/compose/util-map-includes.js
var require_util_map_includes = __commonJS({
  "../node_modules/yaml/dist/compose/util-map-includes.js"(exports2) {
    "use strict";
    var identity = require_identity();
    function mapIncludes(ctx, items, search) {
      const { uniqueKeys } = ctx.options;
      if (uniqueKeys === false)
        return false;
      const isEqual = typeof uniqueKeys === "function" ? uniqueKeys : (a, b) => a === b || identity.isScalar(a) && identity.isScalar(b) && a.value === b.value;
      return items.some((pair) => isEqual(pair.key, search));
    }
    exports2.mapIncludes = mapIncludes;
  }
});

// ../node_modules/yaml/dist/compose/resolve-block-map.js
var require_resolve_block_map = __commonJS({
  "../node_modules/yaml/dist/compose/resolve-block-map.js"(exports2) {
    "use strict";
    var Pair = require_Pair();
    var YAMLMap = require_YAMLMap();
    var resolveProps = require_resolve_props();
    var utilContainsNewline = require_util_contains_newline();
    var utilFlowIndentCheck = require_util_flow_indent_check();
    var utilMapIncludes = require_util_map_includes();
    var startColMsg = "All mapping items must start at the same column";
    function resolveBlockMap({ composeNode, composeEmptyNode }, ctx, bm, onError, tag) {
      const NodeClass = tag?.nodeClass ?? YAMLMap.YAMLMap;
      const map = new NodeClass(ctx.schema);
      if (ctx.atRoot)
        ctx.atRoot = false;
      let offset = bm.offset;
      let commentEnd = null;
      for (const collItem of bm.items) {
        const { start, key, sep, value } = collItem;
        const keyProps = resolveProps.resolveProps(start, {
          indicator: "explicit-key-ind",
          next: key ?? sep?.[0],
          offset,
          onError,
          parentIndent: bm.indent,
          startOnNewline: true
        });
        const implicitKey = !keyProps.found;
        if (implicitKey) {
          if (key) {
            if (key.type === "block-seq")
              onError(offset, "BLOCK_AS_IMPLICIT_KEY", "A block sequence may not be used as an implicit map key");
            else if ("indent" in key && key.indent !== bm.indent)
              onError(offset, "BAD_INDENT", startColMsg);
          }
          if (!keyProps.anchor && !keyProps.tag && !sep) {
            commentEnd = keyProps.end;
            if (keyProps.comment) {
              if (map.comment)
                map.comment += "\n" + keyProps.comment;
              else
                map.comment = keyProps.comment;
            }
            continue;
          }
          if (keyProps.newlineAfterProp || utilContainsNewline.containsNewline(key)) {
            onError(key ?? start[start.length - 1], "MULTILINE_IMPLICIT_KEY", "Implicit keys need to be on a single line");
          }
        } else if (keyProps.found?.indent !== bm.indent) {
          onError(offset, "BAD_INDENT", startColMsg);
        }
        ctx.atKey = true;
        const keyStart = keyProps.end;
        const keyNode = key ? composeNode(ctx, key, keyProps, onError) : composeEmptyNode(ctx, keyStart, start, null, keyProps, onError);
        if (ctx.schema.compat)
          utilFlowIndentCheck.flowIndentCheck(bm.indent, key, onError);
        ctx.atKey = false;
        if (utilMapIncludes.mapIncludes(ctx, map.items, keyNode))
          onError(keyStart, "DUPLICATE_KEY", "Map keys must be unique");
        const valueProps = resolveProps.resolveProps(sep ?? [], {
          indicator: "map-value-ind",
          next: value,
          offset: keyNode.range[2],
          onError,
          parentIndent: bm.indent,
          startOnNewline: !key || key.type === "block-scalar"
        });
        offset = valueProps.end;
        if (valueProps.found) {
          if (implicitKey) {
            if (value?.type === "block-map" && !valueProps.hasNewline)
              onError(offset, "BLOCK_AS_IMPLICIT_KEY", "Nested mappings are not allowed in compact mappings");
            if (ctx.options.strict && keyProps.start < valueProps.found.offset - 1024)
              onError(keyNode.range, "KEY_OVER_1024_CHARS", "The : indicator must be at most 1024 chars after the start of an implicit block mapping key");
          }
          const valueNode = value ? composeNode(ctx, value, valueProps, onError) : composeEmptyNode(ctx, offset, sep, null, valueProps, onError);
          if (ctx.schema.compat)
            utilFlowIndentCheck.flowIndentCheck(bm.indent, value, onError);
          offset = valueNode.range[2];
          const pair = new Pair.Pair(keyNode, valueNode);
          if (ctx.options.keepSourceTokens)
            pair.srcToken = collItem;
          map.items.push(pair);
        } else {
          if (implicitKey)
            onError(keyNode.range, "MISSING_CHAR", "Implicit map keys need to be followed by map values");
          if (valueProps.comment) {
            if (keyNode.comment)
              keyNode.comment += "\n" + valueProps.comment;
            else
              keyNode.comment = valueProps.comment;
          }
          const pair = new Pair.Pair(keyNode);
          if (ctx.options.keepSourceTokens)
            pair.srcToken = collItem;
          map.items.push(pair);
        }
      }
      if (commentEnd && commentEnd < offset)
        onError(commentEnd, "IMPOSSIBLE", "Map comment with trailing content");
      map.range = [bm.offset, offset, commentEnd ?? offset];
      return map;
    }
    exports2.resolveBlockMap = resolveBlockMap;
  }
});

// ../node_modules/yaml/dist/compose/resolve-block-seq.js
var require_resolve_block_seq = __commonJS({
  "../node_modules/yaml/dist/compose/resolve-block-seq.js"(exports2) {
    "use strict";
    var YAMLSeq = require_YAMLSeq();
    var resolveProps = require_resolve_props();
    var utilFlowIndentCheck = require_util_flow_indent_check();
    function resolveBlockSeq({ composeNode, composeEmptyNode }, ctx, bs, onError, tag) {
      const NodeClass = tag?.nodeClass ?? YAMLSeq.YAMLSeq;
      const seq = new NodeClass(ctx.schema);
      if (ctx.atRoot)
        ctx.atRoot = false;
      if (ctx.atKey)
        ctx.atKey = false;
      let offset = bs.offset;
      let commentEnd = null;
      for (const { start, value } of bs.items) {
        const props = resolveProps.resolveProps(start, {
          indicator: "seq-item-ind",
          next: value,
          offset,
          onError,
          parentIndent: bs.indent,
          startOnNewline: true
        });
        if (!props.found) {
          if (props.anchor || props.tag || value) {
            if (value?.type === "block-seq")
              onError(props.end, "BAD_INDENT", "All sequence items must start at the same column");
            else
              onError(offset, "MISSING_CHAR", "Sequence item without - indicator");
          } else {
            commentEnd = props.end;
            if (props.comment)
              seq.comment = props.comment;
            continue;
          }
        }
        const node = value ? composeNode(ctx, value, props, onError) : composeEmptyNode(ctx, props.end, start, null, props, onError);
        if (ctx.schema.compat)
          utilFlowIndentCheck.flowIndentCheck(bs.indent, value, onError);
        offset = node.range[2];
        seq.items.push(node);
      }
      seq.range = [bs.offset, offset, commentEnd ?? offset];
      return seq;
    }
    exports2.resolveBlockSeq = resolveBlockSeq;
  }
});

// ../node_modules/yaml/dist/compose/resolve-end.js
var require_resolve_end = __commonJS({
  "../node_modules/yaml/dist/compose/resolve-end.js"(exports2) {
    "use strict";
    function resolveEnd(end, offset, reqSpace, onError) {
      let comment = "";
      if (end) {
        let hasSpace = false;
        let sep = "";
        for (const token of end) {
          const { source, type } = token;
          switch (type) {
            case "space":
              hasSpace = true;
              break;
            case "comment": {
              if (reqSpace && !hasSpace)
                onError(token, "MISSING_CHAR", "Comments must be separated from other tokens by white space characters");
              const cb = source.substring(1) || " ";
              if (!comment)
                comment = cb;
              else
                comment += sep + cb;
              sep = "";
              break;
            }
            case "newline":
              if (comment)
                sep += source;
              hasSpace = true;
              break;
            default:
              onError(token, "UNEXPECTED_TOKEN", `Unexpected ${type} at node end`);
          }
          offset += source.length;
        }
      }
      return { comment, offset };
    }
    exports2.resolveEnd = resolveEnd;
  }
});

// ../node_modules/yaml/dist/compose/resolve-flow-collection.js
var require_resolve_flow_collection = __commonJS({
  "../node_modules/yaml/dist/compose/resolve-flow-collection.js"(exports2) {
    "use strict";
    var identity = require_identity();
    var Pair = require_Pair();
    var YAMLMap = require_YAMLMap();
    var YAMLSeq = require_YAMLSeq();
    var resolveEnd = require_resolve_end();
    var resolveProps = require_resolve_props();
    var utilContainsNewline = require_util_contains_newline();
    var utilMapIncludes = require_util_map_includes();
    var blockMsg = "Block collections are not allowed within flow collections";
    var isBlock = (token) => token && (token.type === "block-map" || token.type === "block-seq");
    function resolveFlowCollection({ composeNode, composeEmptyNode }, ctx, fc, onError, tag) {
      const isMap = fc.start.source === "{";
      const fcName = isMap ? "flow map" : "flow sequence";
      const NodeClass = tag?.nodeClass ?? (isMap ? YAMLMap.YAMLMap : YAMLSeq.YAMLSeq);
      const coll = new NodeClass(ctx.schema);
      coll.flow = true;
      const atRoot = ctx.atRoot;
      if (atRoot)
        ctx.atRoot = false;
      if (ctx.atKey)
        ctx.atKey = false;
      let offset = fc.offset + fc.start.source.length;
      for (let i = 0; i < fc.items.length; ++i) {
        const collItem = fc.items[i];
        const { start, key, sep, value } = collItem;
        const props = resolveProps.resolveProps(start, {
          flow: fcName,
          indicator: "explicit-key-ind",
          next: key ?? sep?.[0],
          offset,
          onError,
          parentIndent: fc.indent,
          startOnNewline: false
        });
        if (!props.found) {
          if (!props.anchor && !props.tag && !sep && !value) {
            if (i === 0 && props.comma)
              onError(props.comma, "UNEXPECTED_TOKEN", `Unexpected , in ${fcName}`);
            else if (i < fc.items.length - 1)
              onError(props.start, "UNEXPECTED_TOKEN", `Unexpected empty item in ${fcName}`);
            if (props.comment) {
              if (coll.comment)
                coll.comment += "\n" + props.comment;
              else
                coll.comment = props.comment;
            }
            offset = props.end;
            continue;
          }
          if (!isMap && ctx.options.strict && utilContainsNewline.containsNewline(key))
            onError(
              key,
              // checked by containsNewline()
              "MULTILINE_IMPLICIT_KEY",
              "Implicit keys of flow sequence pairs need to be on a single line"
            );
        }
        if (i === 0) {
          if (props.comma)
            onError(props.comma, "UNEXPECTED_TOKEN", `Unexpected , in ${fcName}`);
        } else {
          if (!props.comma)
            onError(props.start, "MISSING_CHAR", `Missing , between ${fcName} items`);
          if (props.comment) {
            let prevItemComment = "";
            loop: for (const st of start) {
              switch (st.type) {
                case "comma":
                case "space":
                  break;
                case "comment":
                  prevItemComment = st.source.substring(1);
                  break loop;
                default:
                  break loop;
              }
            }
            if (prevItemComment) {
              let prev = coll.items[coll.items.length - 1];
              if (identity.isPair(prev))
                prev = prev.value ?? prev.key;
              if (prev.comment)
                prev.comment += "\n" + prevItemComment;
              else
                prev.comment = prevItemComment;
              props.comment = props.comment.substring(prevItemComment.length + 1);
            }
          }
        }
        if (!isMap && !sep && !props.found) {
          const valueNode = value ? composeNode(ctx, value, props, onError) : composeEmptyNode(ctx, props.end, sep, null, props, onError);
          coll.items.push(valueNode);
          offset = valueNode.range[2];
          if (isBlock(value))
            onError(valueNode.range, "BLOCK_IN_FLOW", blockMsg);
        } else {
          ctx.atKey = true;
          const keyStart = props.end;
          const keyNode = key ? composeNode(ctx, key, props, onError) : composeEmptyNode(ctx, keyStart, start, null, props, onError);
          if (isBlock(key))
            onError(keyNode.range, "BLOCK_IN_FLOW", blockMsg);
          ctx.atKey = false;
          const valueProps = resolveProps.resolveProps(sep ?? [], {
            flow: fcName,
            indicator: "map-value-ind",
            next: value,
            offset: keyNode.range[2],
            onError,
            parentIndent: fc.indent,
            startOnNewline: false
          });
          if (valueProps.found) {
            if (!isMap && !props.found && ctx.options.strict) {
              if (sep)
                for (const st of sep) {
                  if (st === valueProps.found)
                    break;
                  if (st.type === "newline") {
                    onError(st, "MULTILINE_IMPLICIT_KEY", "Implicit keys of flow sequence pairs need to be on a single line");
                    break;
                  }
                }
              if (props.start < valueProps.found.offset - 1024)
                onError(valueProps.found, "KEY_OVER_1024_CHARS", "The : indicator must be at most 1024 chars after the start of an implicit flow sequence key");
            }
          } else if (value) {
            if ("source" in value && value.source?.[0] === ":")
              onError(value, "MISSING_CHAR", `Missing space after : in ${fcName}`);
            else
              onError(valueProps.start, "MISSING_CHAR", `Missing , or : between ${fcName} items`);
          }
          const valueNode = value ? composeNode(ctx, value, valueProps, onError) : valueProps.found ? composeEmptyNode(ctx, valueProps.end, sep, null, valueProps, onError) : null;
          if (valueNode) {
            if (isBlock(value))
              onError(valueNode.range, "BLOCK_IN_FLOW", blockMsg);
          } else if (valueProps.comment) {
            if (keyNode.comment)
              keyNode.comment += "\n" + valueProps.comment;
            else
              keyNode.comment = valueProps.comment;
          }
          const pair = new Pair.Pair(keyNode, valueNode);
          if (ctx.options.keepSourceTokens)
            pair.srcToken = collItem;
          if (isMap) {
            const map = coll;
            if (utilMapIncludes.mapIncludes(ctx, map.items, keyNode))
              onError(keyStart, "DUPLICATE_KEY", "Map keys must be unique");
            map.items.push(pair);
          } else {
            const map = new YAMLMap.YAMLMap(ctx.schema);
            map.flow = true;
            map.items.push(pair);
            const endRange = (valueNode ?? keyNode).range;
            map.range = [keyNode.range[0], endRange[1], endRange[2]];
            coll.items.push(map);
          }
          offset = valueNode ? valueNode.range[2] : valueProps.end;
        }
      }
      const expectedEnd = isMap ? "}" : "]";
      const [ce, ...ee] = fc.end;
      let cePos = offset;
      if (ce?.source === expectedEnd)
        cePos = ce.offset + ce.source.length;
      else {
        const name = fcName[0].toUpperCase() + fcName.substring(1);
        const msg = atRoot ? `${name} must end with a ${expectedEnd}` : `${name} in block collection must be sufficiently indented and end with a ${expectedEnd}`;
        onError(offset, atRoot ? "MISSING_CHAR" : "BAD_INDENT", msg);
        if (ce && ce.source.length !== 1)
          ee.unshift(ce);
      }
      if (ee.length > 0) {
        const end = resolveEnd.resolveEnd(ee, cePos, ctx.options.strict, onError);
        if (end.comment) {
          if (coll.comment)
            coll.comment += "\n" + end.comment;
          else
            coll.comment = end.comment;
        }
        coll.range = [fc.offset, cePos, end.offset];
      } else {
        coll.range = [fc.offset, cePos, cePos];
      }
      return coll;
    }
    exports2.resolveFlowCollection = resolveFlowCollection;
  }
});

// ../node_modules/yaml/dist/compose/compose-collection.js
var require_compose_collection = __commonJS({
  "../node_modules/yaml/dist/compose/compose-collection.js"(exports2) {
    "use strict";
    var identity = require_identity();
    var Scalar = require_Scalar();
    var YAMLMap = require_YAMLMap();
    var YAMLSeq = require_YAMLSeq();
    var resolveBlockMap = require_resolve_block_map();
    var resolveBlockSeq = require_resolve_block_seq();
    var resolveFlowCollection = require_resolve_flow_collection();
    function resolveCollection(CN, ctx, token, onError, tagName, tag) {
      const coll = token.type === "block-map" ? resolveBlockMap.resolveBlockMap(CN, ctx, token, onError, tag) : token.type === "block-seq" ? resolveBlockSeq.resolveBlockSeq(CN, ctx, token, onError, tag) : resolveFlowCollection.resolveFlowCollection(CN, ctx, token, onError, tag);
      const Coll = coll.constructor;
      if (tagName === "!" || tagName === Coll.tagName) {
        coll.tag = Coll.tagName;
        return coll;
      }
      if (tagName)
        coll.tag = tagName;
      return coll;
    }
    function composeCollection(CN, ctx, token, props, onError) {
      const tagToken = props.tag;
      const tagName = !tagToken ? null : ctx.directives.tagName(tagToken.source, (msg) => onError(tagToken, "TAG_RESOLVE_FAILED", msg));
      if (token.type === "block-seq") {
        const { anchor, newlineAfterProp: nl } = props;
        const lastProp = anchor && tagToken ? anchor.offset > tagToken.offset ? anchor : tagToken : anchor ?? tagToken;
        if (lastProp && (!nl || nl.offset < lastProp.offset)) {
          const message = "Missing newline after block sequence props";
          onError(lastProp, "MISSING_CHAR", message);
        }
      }
      const expType = token.type === "block-map" ? "map" : token.type === "block-seq" ? "seq" : token.start.source === "{" ? "map" : "seq";
      if (!tagToken || !tagName || tagName === "!" || tagName === YAMLMap.YAMLMap.tagName && expType === "map" || tagName === YAMLSeq.YAMLSeq.tagName && expType === "seq") {
        return resolveCollection(CN, ctx, token, onError, tagName);
      }
      let tag = ctx.schema.tags.find((t) => t.tag === tagName && t.collection === expType);
      if (!tag) {
        const kt = ctx.schema.knownTags[tagName];
        if (kt?.collection === expType) {
          ctx.schema.tags.push(Object.assign({}, kt, { default: false }));
          tag = kt;
        } else {
          if (kt) {
            onError(tagToken, "BAD_COLLECTION_TYPE", `${kt.tag} used for ${expType} collection, but expects ${kt.collection ?? "scalar"}`, true);
          } else {
            onError(tagToken, "TAG_RESOLVE_FAILED", `Unresolved tag: ${tagName}`, true);
          }
          return resolveCollection(CN, ctx, token, onError, tagName);
        }
      }
      const coll = resolveCollection(CN, ctx, token, onError, tagName, tag);
      const res = tag.resolve?.(coll, (msg) => onError(tagToken, "TAG_RESOLVE_FAILED", msg), ctx.options) ?? coll;
      const node = identity.isNode(res) ? res : new Scalar.Scalar(res);
      node.range = coll.range;
      node.tag = tagName;
      if (tag?.format)
        node.format = tag.format;
      return node;
    }
    exports2.composeCollection = composeCollection;
  }
});

// ../node_modules/yaml/dist/compose/resolve-block-scalar.js
var require_resolve_block_scalar = __commonJS({
  "../node_modules/yaml/dist/compose/resolve-block-scalar.js"(exports2) {
    "use strict";
    var Scalar = require_Scalar();
    function resolveBlockScalar(ctx, scalar, onError) {
      const start = scalar.offset;
      const header = parseBlockScalarHeader(scalar, ctx.options.strict, onError);
      if (!header)
        return { value: "", type: null, comment: "", range: [start, start, start] };
      const type = header.mode === ">" ? Scalar.Scalar.BLOCK_FOLDED : Scalar.Scalar.BLOCK_LITERAL;
      const lines = scalar.source ? splitLines(scalar.source) : [];
      let chompStart = lines.length;
      for (let i = lines.length - 1; i >= 0; --i) {
        const content = lines[i][1];
        if (content === "" || content === "\r")
          chompStart = i;
        else
          break;
      }
      if (chompStart === 0) {
        const value2 = header.chomp === "+" && lines.length > 0 ? "\n".repeat(Math.max(1, lines.length - 1)) : "";
        let end2 = start + header.length;
        if (scalar.source)
          end2 += scalar.source.length;
        return { value: value2, type, comment: header.comment, range: [start, end2, end2] };
      }
      let trimIndent = scalar.indent + header.indent;
      let offset = scalar.offset + header.length;
      let contentStart = 0;
      for (let i = 0; i < chompStart; ++i) {
        const [indent, content] = lines[i];
        if (content === "" || content === "\r") {
          if (header.indent === 0 && indent.length > trimIndent)
            trimIndent = indent.length;
        } else {
          if (indent.length < trimIndent) {
            const message = "Block scalars with more-indented leading empty lines must use an explicit indentation indicator";
            onError(offset + indent.length, "MISSING_CHAR", message);
          }
          if (header.indent === 0)
            trimIndent = indent.length;
          contentStart = i;
          if (trimIndent === 0 && !ctx.atRoot) {
            const message = "Block scalar values in collections must be indented";
            onError(offset, "BAD_INDENT", message);
          }
          break;
        }
        offset += indent.length + content.length + 1;
      }
      for (let i = lines.length - 1; i >= chompStart; --i) {
        if (lines[i][0].length > trimIndent)
          chompStart = i + 1;
      }
      let value = "";
      let sep = "";
      let prevMoreIndented = false;
      for (let i = 0; i < contentStart; ++i)
        value += lines[i][0].slice(trimIndent) + "\n";
      for (let i = contentStart; i < chompStart; ++i) {
        let [indent, content] = lines[i];
        offset += indent.length + content.length + 1;
        const crlf = content[content.length - 1] === "\r";
        if (crlf)
          content = content.slice(0, -1);
        if (content && indent.length < trimIndent) {
          const src = header.indent ? "explicit indentation indicator" : "first line";
          const message = `Block scalar lines must not be less indented than their ${src}`;
          onError(offset - content.length - (crlf ? 2 : 1), "BAD_INDENT", message);
          indent = "";
        }
        if (type === Scalar.Scalar.BLOCK_LITERAL) {
          value += sep + indent.slice(trimIndent) + content;
          sep = "\n";
        } else if (indent.length > trimIndent || content[0] === "	") {
          if (sep === " ")
            sep = "\n";
          else if (!prevMoreIndented && sep === "\n")
            sep = "\n\n";
          value += sep + indent.slice(trimIndent) + content;
          sep = "\n";
          prevMoreIndented = true;
        } else if (content === "") {
          if (sep === "\n")
            value += "\n";
          else
            sep = "\n";
        } else {
          value += sep + content;
          sep = " ";
          prevMoreIndented = false;
        }
      }
      switch (header.chomp) {
        case "-":
          break;
        case "+":
          for (let i = chompStart; i < lines.length; ++i)
            value += "\n" + lines[i][0].slice(trimIndent);
          if (value[value.length - 1] !== "\n")
            value += "\n";
          break;
        default:
          value += "\n";
      }
      const end = start + header.length + scalar.source.length;
      return { value, type, comment: header.comment, range: [start, end, end] };
    }
    function parseBlockScalarHeader({ offset, props }, strict, onError) {
      if (props[0].type !== "block-scalar-header") {
        onError(props[0], "IMPOSSIBLE", "Block scalar header not found");
        return null;
      }
      const { source } = props[0];
      const mode = source[0];
      let indent = 0;
      let chomp = "";
      let error = -1;
      for (let i = 1; i < source.length; ++i) {
        const ch = source[i];
        if (!chomp && (ch === "-" || ch === "+"))
          chomp = ch;
        else {
          const n = Number(ch);
          if (!indent && n)
            indent = n;
          else if (error === -1)
            error = offset + i;
        }
      }
      if (error !== -1)
        onError(error, "UNEXPECTED_TOKEN", `Block scalar header includes extra characters: ${source}`);
      let hasSpace = false;
      let comment = "";
      let length = source.length;
      for (let i = 1; i < props.length; ++i) {
        const token = props[i];
        switch (token.type) {
          case "space":
            hasSpace = true;
          // fallthrough
          case "newline":
            length += token.source.length;
            break;
          case "comment":
            if (strict && !hasSpace) {
              const message = "Comments must be separated from other tokens by white space characters";
              onError(token, "MISSING_CHAR", message);
            }
            length += token.source.length;
            comment = token.source.substring(1);
            break;
          case "error":
            onError(token, "UNEXPECTED_TOKEN", token.message);
            length += token.source.length;
            break;
          /* istanbul ignore next should not happen */
          default: {
            const message = `Unexpected token in block scalar header: ${token.type}`;
            onError(token, "UNEXPECTED_TOKEN", message);
            const ts = token.source;
            if (ts && typeof ts === "string")
              length += ts.length;
          }
        }
      }
      return { mode, indent, chomp, comment, length };
    }
    function splitLines(source) {
      const split = source.split(/\n( *)/);
      const first = split[0];
      const m = first.match(/^( *)/);
      const line0 = m?.[1] ? [m[1], first.slice(m[1].length)] : ["", first];
      const lines = [line0];
      for (let i = 1; i < split.length; i += 2)
        lines.push([split[i], split[i + 1]]);
      return lines;
    }
    exports2.resolveBlockScalar = resolveBlockScalar;
  }
});

// ../node_modules/yaml/dist/compose/resolve-flow-scalar.js
var require_resolve_flow_scalar = __commonJS({
  "../node_modules/yaml/dist/compose/resolve-flow-scalar.js"(exports2) {
    "use strict";
    var Scalar = require_Scalar();
    var resolveEnd = require_resolve_end();
    function resolveFlowScalar(scalar, strict, onError) {
      const { offset, type, source, end } = scalar;
      let _type;
      let value;
      const _onError = (rel, code, msg) => onError(offset + rel, code, msg);
      switch (type) {
        case "scalar":
          _type = Scalar.Scalar.PLAIN;
          value = plainValue(source, _onError);
          break;
        case "single-quoted-scalar":
          _type = Scalar.Scalar.QUOTE_SINGLE;
          value = singleQuotedValue(source, _onError);
          break;
        case "double-quoted-scalar":
          _type = Scalar.Scalar.QUOTE_DOUBLE;
          value = doubleQuotedValue(source, _onError);
          break;
        /* istanbul ignore next should not happen */
        default:
          onError(scalar, "UNEXPECTED_TOKEN", `Expected a flow scalar value, but found: ${type}`);
          return {
            value: "",
            type: null,
            comment: "",
            range: [offset, offset + source.length, offset + source.length]
          };
      }
      const valueEnd = offset + source.length;
      const re = resolveEnd.resolveEnd(end, valueEnd, strict, onError);
      return {
        value,
        type: _type,
        comment: re.comment,
        range: [offset, valueEnd, re.offset]
      };
    }
    function plainValue(source, onError) {
      let badChar = "";
      switch (source[0]) {
        /* istanbul ignore next should not happen */
        case "	":
          badChar = "a tab character";
          break;
        case ",":
          badChar = "flow indicator character ,";
          break;
        case "%":
          badChar = "directive indicator character %";
          break;
        case "|":
        case ">": {
          badChar = `block scalar indicator ${source[0]}`;
          break;
        }
        case "@":
        case "`": {
          badChar = `reserved character ${source[0]}`;
          break;
        }
      }
      if (badChar)
        onError(0, "BAD_SCALAR_START", `Plain value cannot start with ${badChar}`);
      return unfoldLines(source);
    }
    function singleQuotedValue(source, onError) {
      if (source[source.length - 1] !== "'" || source.length === 1)
        onError(source.length, "MISSING_CHAR", "Missing closing 'quote");
      return unfoldLines(source.slice(1, -1)).replace(/''/g, "'");
    }
    function unfoldLines(source) {
      const line = /(.*?)\r?\n/sy;
      let match = line.exec(source);
      if (!match)
        return source;
      let trimEnd, trimBoth;
      try {
        trimEnd = new RegExp("(?<![ 	])[ 	]+$");
        trimBoth = new RegExp("^[ 	]+|(?<![ 	])[ 	]+$", "g");
      } catch {
        trimEnd = /[ \t]+$/;
        trimBoth = /^[ \t]+|[ \t]+$/g;
      }
      let res = match[1].replace(trimEnd, "");
      let sep = " ";
      let pos = line.lastIndex;
      while (match = line.exec(source)) {
        const lm = match[1].replace(trimBoth, "");
        if (lm === "") {
          if (sep === "\n")
            res += sep;
          else
            sep = "\n";
        } else {
          res += sep + lm;
          sep = " ";
        }
        pos = line.lastIndex;
      }
      const last = /[ \t]*(.*)/sy;
      last.lastIndex = pos;
      match = last.exec(source);
      return res + sep + (match?.[1] ?? "");
    }
    function doubleQuotedValue(source, onError) {
      let res = "";
      for (let i = 1; i < source.length - 1; ++i) {
        const ch = source[i];
        if (ch === "\r" && source[i + 1] === "\n")
          continue;
        if (ch === "\n") {
          const { fold, offset } = foldNewline(source, i);
          res += fold;
          i = offset;
        } else if (ch === "\\") {
          let next = source[++i];
          const cc = escapeCodes[next];
          if (cc)
            res += cc;
          else if (next === "\n") {
            next = source[i + 1];
            while (next === " " || next === "	")
              next = source[++i + 1];
          } else if (next === "\r" && source[i + 1] === "\n") {
            next = source[++i + 1];
            while (next === " " || next === "	")
              next = source[++i + 1];
          } else if (next === "x" || next === "u" || next === "U") {
            const length = next === "x" ? 2 : next === "u" ? 4 : 8;
            res += parseCharCode(source, i + 1, length, onError);
            i += length;
          } else {
            const raw = source.substr(i - 1, 2);
            onError(i - 1, "BAD_DQ_ESCAPE", `Invalid escape sequence ${raw}`);
            res += raw;
          }
        } else if (ch === " " || ch === "	") {
          const wsStart = i;
          let next = source[i + 1];
          while (next === " " || next === "	")
            next = source[++i + 1];
          if (next !== "\n" && !(next === "\r" && source[i + 2] === "\n"))
            res += i > wsStart ? source.slice(wsStart, i + 1) : ch;
        } else {
          res += ch;
        }
      }
      if (source[source.length - 1] !== '"' || source.length === 1)
        onError(source.length, "MISSING_CHAR", 'Missing closing "quote');
      return res;
    }
    function foldNewline(source, offset) {
      let fold = "";
      let ch = source[offset + 1];
      while (ch === " " || ch === "	" || ch === "\n" || ch === "\r") {
        if (ch === "\r" && source[offset + 2] !== "\n")
          break;
        if (ch === "\n")
          fold += "\n";
        offset += 1;
        ch = source[offset + 1];
      }
      if (!fold)
        fold = " ";
      return { fold, offset };
    }
    var escapeCodes = {
      "0": "\0",
      // null character
      a: "\x07",
      // bell character
      b: "\b",
      // backspace
      e: "\x1B",
      // escape character
      f: "\f",
      // form feed
      n: "\n",
      // line feed
      r: "\r",
      // carriage return
      t: "	",
      // horizontal tab
      v: "\v",
      // vertical tab
      N: "\x85",
      // Unicode next line
      _: "\xA0",
      // Unicode non-breaking space
      L: "\u2028",
      // Unicode line separator
      P: "\u2029",
      // Unicode paragraph separator
      " ": " ",
      '"': '"',
      "/": "/",
      "\\": "\\",
      "	": "	"
    };
    function parseCharCode(source, offset, length, onError) {
      const cc = source.substr(offset, length);
      const ok = cc.length === length && /^[0-9a-fA-F]+$/.test(cc);
      const code = ok ? parseInt(cc, 16) : NaN;
      try {
        return String.fromCodePoint(code);
      } catch {
        const raw = source.substr(offset - 2, length + 2);
        onError(offset - 2, "BAD_DQ_ESCAPE", `Invalid escape sequence ${raw}`);
        return raw;
      }
    }
    exports2.resolveFlowScalar = resolveFlowScalar;
  }
});

// ../node_modules/yaml/dist/compose/compose-scalar.js
var require_compose_scalar = __commonJS({
  "../node_modules/yaml/dist/compose/compose-scalar.js"(exports2) {
    "use strict";
    var identity = require_identity();
    var Scalar = require_Scalar();
    var resolveBlockScalar = require_resolve_block_scalar();
    var resolveFlowScalar = require_resolve_flow_scalar();
    function composeScalar(ctx, token, tagToken, onError) {
      const { value, type, comment, range } = token.type === "block-scalar" ? resolveBlockScalar.resolveBlockScalar(ctx, token, onError) : resolveFlowScalar.resolveFlowScalar(token, ctx.options.strict, onError);
      const tagName = tagToken ? ctx.directives.tagName(tagToken.source, (msg) => onError(tagToken, "TAG_RESOLVE_FAILED", msg)) : null;
      let tag;
      if (ctx.options.stringKeys && ctx.atKey) {
        tag = ctx.schema[identity.SCALAR];
      } else if (tagName)
        tag = findScalarTagByName(ctx.schema, value, tagName, tagToken, onError);
      else if (token.type === "scalar")
        tag = findScalarTagByTest(ctx, value, token, onError);
      else
        tag = ctx.schema[identity.SCALAR];
      let scalar;
      try {
        const res = tag.resolve(value, (msg) => onError(tagToken ?? token, "TAG_RESOLVE_FAILED", msg), ctx.options);
        scalar = identity.isScalar(res) ? res : new Scalar.Scalar(res);
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        onError(tagToken ?? token, "TAG_RESOLVE_FAILED", msg);
        scalar = new Scalar.Scalar(value);
      }
      scalar.range = range;
      scalar.source = value;
      if (type)
        scalar.type = type;
      if (tagName)
        scalar.tag = tagName;
      if (tag.format)
        scalar.format = tag.format;
      if (comment)
        scalar.comment = comment;
      return scalar;
    }
    function findScalarTagByName(schema, value, tagName, tagToken, onError) {
      if (tagName === "!")
        return schema[identity.SCALAR];
      const matchWithTest = [];
      for (const tag of schema.tags) {
        if (!tag.collection && tag.tag === tagName) {
          if (tag.default && tag.test)
            matchWithTest.push(tag);
          else
            return tag;
        }
      }
      for (const tag of matchWithTest)
        if (tag.test?.test(value))
          return tag;
      const kt = schema.knownTags[tagName];
      if (kt && !kt.collection) {
        schema.tags.push(Object.assign({}, kt, { default: false, test: void 0 }));
        return kt;
      }
      onError(tagToken, "TAG_RESOLVE_FAILED", `Unresolved tag: ${tagName}`, tagName !== "tag:yaml.org,2002:str");
      return schema[identity.SCALAR];
    }
    function findScalarTagByTest({ atKey, directives, schema }, value, token, onError) {
      const tag = schema.tags.find((tag2) => (tag2.default === true || atKey && tag2.default === "key") && tag2.test?.test(value)) || schema[identity.SCALAR];
      if (schema.compat) {
        const compat = schema.compat.find((tag2) => tag2.default && tag2.test?.test(value)) ?? schema[identity.SCALAR];
        if (tag.tag !== compat.tag) {
          const ts = directives.tagString(tag.tag);
          const cs = directives.tagString(compat.tag);
          const msg = `Value may be parsed as either ${ts} or ${cs}`;
          onError(token, "TAG_RESOLVE_FAILED", msg, true);
        }
      }
      return tag;
    }
    exports2.composeScalar = composeScalar;
  }
});

// ../node_modules/yaml/dist/compose/util-empty-scalar-position.js
var require_util_empty_scalar_position = __commonJS({
  "../node_modules/yaml/dist/compose/util-empty-scalar-position.js"(exports2) {
    "use strict";
    function emptyScalarPosition(offset, before, pos) {
      if (before) {
        pos ?? (pos = before.length);
        for (let i = pos - 1; i >= 0; --i) {
          let st = before[i];
          switch (st.type) {
            case "space":
            case "comment":
            case "newline":
              offset -= st.source.length;
              continue;
          }
          st = before[++i];
          while (st?.type === "space") {
            offset += st.source.length;
            st = before[++i];
          }
          break;
        }
      }
      return offset;
    }
    exports2.emptyScalarPosition = emptyScalarPosition;
  }
});

// ../node_modules/yaml/dist/compose/compose-node.js
var require_compose_node = __commonJS({
  "../node_modules/yaml/dist/compose/compose-node.js"(exports2) {
    "use strict";
    var Alias = require_Alias();
    var identity = require_identity();
    var composeCollection = require_compose_collection();
    var composeScalar = require_compose_scalar();
    var resolveEnd = require_resolve_end();
    var utilEmptyScalarPosition = require_util_empty_scalar_position();
    var CN = { composeNode, composeEmptyNode };
    function composeNode(ctx, token, props, onError) {
      const atKey = ctx.atKey;
      const { spaceBefore, comment, anchor, tag } = props;
      let node;
      let isSrcToken = true;
      switch (token.type) {
        case "alias":
          node = composeAlias(ctx, token, onError);
          if (anchor || tag)
            onError(token, "ALIAS_PROPS", "An alias node must not specify any properties");
          break;
        case "scalar":
        case "single-quoted-scalar":
        case "double-quoted-scalar":
        case "block-scalar":
          node = composeScalar.composeScalar(ctx, token, tag, onError);
          if (anchor)
            node.anchor = anchor.source.substring(1);
          break;
        case "block-map":
        case "block-seq":
        case "flow-collection":
          try {
            node = composeCollection.composeCollection(CN, ctx, token, props, onError);
            if (anchor)
              node.anchor = anchor.source.substring(1);
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            onError(token, "RESOURCE_EXHAUSTION", message);
          }
          break;
        default: {
          const message = token.type === "error" ? token.message : `Unsupported token (type: ${token.type})`;
          onError(token, "UNEXPECTED_TOKEN", message);
          isSrcToken = false;
        }
      }
      node ?? (node = composeEmptyNode(ctx, token.offset, void 0, null, props, onError));
      if (anchor && node.anchor === "")
        onError(anchor, "BAD_ALIAS", "Anchor cannot be an empty string");
      if (atKey && ctx.options.stringKeys && (!identity.isScalar(node) || typeof node.value !== "string" || node.tag && node.tag !== "tag:yaml.org,2002:str")) {
        const msg = "With stringKeys, all keys must be strings";
        onError(tag ?? token, "NON_STRING_KEY", msg);
      }
      if (spaceBefore)
        node.spaceBefore = true;
      if (comment) {
        if (token.type === "scalar" && token.source === "")
          node.comment = comment;
        else
          node.commentBefore = comment;
      }
      if (ctx.options.keepSourceTokens && isSrcToken)
        node.srcToken = token;
      return node;
    }
    function composeEmptyNode(ctx, offset, before, pos, { spaceBefore, comment, anchor, tag, end }, onError) {
      const token = {
        type: "scalar",
        offset: utilEmptyScalarPosition.emptyScalarPosition(offset, before, pos),
        indent: -1,
        source: ""
      };
      const node = composeScalar.composeScalar(ctx, token, tag, onError);
      if (anchor) {
        node.anchor = anchor.source.substring(1);
        if (node.anchor === "")
          onError(anchor, "BAD_ALIAS", "Anchor cannot be an empty string");
      }
      if (spaceBefore)
        node.spaceBefore = true;
      if (comment) {
        node.comment = comment;
        node.range[2] = end;
      }
      return node;
    }
    function composeAlias({ options }, { offset, source, end }, onError) {
      const alias = new Alias.Alias(source.substring(1));
      if (alias.source === "")
        onError(offset, "BAD_ALIAS", "Alias cannot be an empty string");
      if (alias.source.endsWith(":"))
        onError(offset + source.length - 1, "BAD_ALIAS", "Alias ending in : is ambiguous", true);
      const valueEnd = offset + source.length;
      const re = resolveEnd.resolveEnd(end, valueEnd, options.strict, onError);
      alias.range = [offset, valueEnd, re.offset];
      if (re.comment)
        alias.comment = re.comment;
      return alias;
    }
    exports2.composeEmptyNode = composeEmptyNode;
    exports2.composeNode = composeNode;
  }
});

// ../node_modules/yaml/dist/compose/compose-doc.js
var require_compose_doc = __commonJS({
  "../node_modules/yaml/dist/compose/compose-doc.js"(exports2) {
    "use strict";
    var Document = require_Document();
    var composeNode = require_compose_node();
    var resolveEnd = require_resolve_end();
    var resolveProps = require_resolve_props();
    function composeDoc(options, directives, { offset, start, value, end }, onError) {
      const opts = Object.assign({ _directives: directives }, options);
      const doc = new Document.Document(void 0, opts);
      const ctx = {
        atKey: false,
        atRoot: true,
        directives: doc.directives,
        options: doc.options,
        schema: doc.schema
      };
      const props = resolveProps.resolveProps(start, {
        indicator: "doc-start",
        next: value ?? end?.[0],
        offset,
        onError,
        parentIndent: 0,
        startOnNewline: true
      });
      if (props.found) {
        doc.directives.docStart = true;
        if (value && (value.type === "block-map" || value.type === "block-seq") && !props.hasNewline)
          onError(props.end, "MISSING_CHAR", "Block collection cannot start on same line with directives-end marker");
      }
      doc.contents = value ? composeNode.composeNode(ctx, value, props, onError) : composeNode.composeEmptyNode(ctx, props.end, start, null, props, onError);
      const contentEnd = doc.contents.range[2];
      const re = resolveEnd.resolveEnd(end, contentEnd, false, onError);
      if (re.comment)
        doc.comment = re.comment;
      doc.range = [offset, contentEnd, re.offset];
      return doc;
    }
    exports2.composeDoc = composeDoc;
  }
});

// ../node_modules/yaml/dist/compose/composer.js
var require_composer = __commonJS({
  "../node_modules/yaml/dist/compose/composer.js"(exports2) {
    "use strict";
    var node_process = require("process");
    var directives = require_directives();
    var Document = require_Document();
    var errors = require_errors();
    var identity = require_identity();
    var composeDoc = require_compose_doc();
    var resolveEnd = require_resolve_end();
    function getErrorPos(src) {
      if (typeof src === "number")
        return [src, src + 1];
      if (Array.isArray(src))
        return src.length === 2 ? src : [src[0], src[1]];
      const { offset, source } = src;
      return [offset, offset + (typeof source === "string" ? source.length : 1)];
    }
    function parsePrelude(prelude) {
      let comment = "";
      let atComment = false;
      let afterEmptyLine = false;
      for (let i = 0; i < prelude.length; ++i) {
        const source = prelude[i];
        switch (source[0]) {
          case "#":
            comment += (comment === "" ? "" : afterEmptyLine ? "\n\n" : "\n") + (source.substring(1) || " ");
            atComment = true;
            afterEmptyLine = false;
            break;
          case "%":
            if (prelude[i + 1]?.[0] !== "#")
              i += 1;
            atComment = false;
            break;
          default:
            if (!atComment)
              afterEmptyLine = true;
            atComment = false;
        }
      }
      return { comment, afterEmptyLine };
    }
    var Composer = class {
      constructor(options = {}) {
        this.doc = null;
        this.atDirectives = false;
        this.prelude = [];
        this.errors = [];
        this.warnings = [];
        this.onError = (source, code, message, warning) => {
          const pos = getErrorPos(source);
          if (warning)
            this.warnings.push(new errors.YAMLWarning(pos, code, message));
          else
            this.errors.push(new errors.YAMLParseError(pos, code, message));
        };
        this.directives = new directives.Directives({ version: options.version || "1.2" });
        this.options = options;
      }
      decorate(doc, afterDoc) {
        const { comment, afterEmptyLine } = parsePrelude(this.prelude);
        if (comment) {
          const dc = doc.contents;
          if (afterDoc) {
            doc.comment = doc.comment ? `${doc.comment}
${comment}` : comment;
          } else if (afterEmptyLine || doc.directives.docStart || !dc) {
            doc.commentBefore = comment;
          } else if (identity.isCollection(dc) && !dc.flow && dc.items.length > 0) {
            let it = dc.items[0];
            if (identity.isPair(it))
              it = it.key;
            const cb = it.commentBefore;
            it.commentBefore = cb ? `${comment}
${cb}` : comment;
          } else {
            const cb = dc.commentBefore;
            dc.commentBefore = cb ? `${comment}
${cb}` : comment;
          }
        }
        if (afterDoc) {
          for (let i = 0; i < this.errors.length; ++i)
            doc.errors.push(this.errors[i]);
          for (let i = 0; i < this.warnings.length; ++i)
            doc.warnings.push(this.warnings[i]);
        } else {
          doc.errors = this.errors;
          doc.warnings = this.warnings;
        }
        this.prelude = [];
        this.errors = [];
        this.warnings = [];
      }
      /**
       * Current stream status information.
       *
       * Mostly useful at the end of input for an empty stream.
       */
      streamInfo() {
        return {
          comment: parsePrelude(this.prelude).comment,
          directives: this.directives,
          errors: this.errors,
          warnings: this.warnings
        };
      }
      /**
       * Compose tokens into documents.
       *
       * @param forceDoc - If the stream contains no document, still emit a final document including any comments and directives that would be applied to a subsequent document.
       * @param endOffset - Should be set if `forceDoc` is also set, to set the document range end and to indicate errors correctly.
       */
      *compose(tokens, forceDoc = false, endOffset = -1) {
        for (const token of tokens)
          yield* this.next(token);
        yield* this.end(forceDoc, endOffset);
      }
      /** Advance the composer by one CST token. */
      *next(token) {
        if (node_process.env.LOG_STREAM)
          console.dir(token, { depth: null });
        switch (token.type) {
          case "directive":
            this.directives.add(token.source, (offset, message, warning) => {
              const pos = getErrorPos(token);
              pos[0] += offset;
              this.onError(pos, "BAD_DIRECTIVE", message, warning);
            });
            this.prelude.push(token.source);
            this.atDirectives = true;
            break;
          case "document": {
            const doc = composeDoc.composeDoc(this.options, this.directives, token, this.onError);
            if (this.atDirectives && !doc.directives.docStart)
              this.onError(token, "MISSING_CHAR", "Missing directives-end/doc-start indicator line");
            this.decorate(doc, false);
            if (this.doc)
              yield this.doc;
            this.doc = doc;
            this.atDirectives = false;
            break;
          }
          case "byte-order-mark":
          case "space":
            break;
          case "comment":
          case "newline":
            this.prelude.push(token.source);
            break;
          case "error": {
            const msg = token.source ? `${token.message}: ${JSON.stringify(token.source)}` : token.message;
            const error = new errors.YAMLParseError(getErrorPos(token), "UNEXPECTED_TOKEN", msg);
            if (this.atDirectives || !this.doc)
              this.errors.push(error);
            else
              this.doc.errors.push(error);
            break;
          }
          case "doc-end": {
            if (!this.doc) {
              const msg = "Unexpected doc-end without preceding document";
              this.errors.push(new errors.YAMLParseError(getErrorPos(token), "UNEXPECTED_TOKEN", msg));
              break;
            }
            this.doc.directives.docEnd = true;
            const end = resolveEnd.resolveEnd(token.end, token.offset + token.source.length, this.doc.options.strict, this.onError);
            this.decorate(this.doc, true);
            if (end.comment) {
              const dc = this.doc.comment;
              this.doc.comment = dc ? `${dc}
${end.comment}` : end.comment;
            }
            this.doc.range[2] = end.offset;
            break;
          }
          default:
            this.errors.push(new errors.YAMLParseError(getErrorPos(token), "UNEXPECTED_TOKEN", `Unsupported token ${token.type}`));
        }
      }
      /**
       * Call at end of input to yield any remaining document.
       *
       * @param forceDoc - If the stream contains no document, still emit a final document including any comments and directives that would be applied to a subsequent document.
       * @param endOffset - Should be set if `forceDoc` is also set, to set the document range end and to indicate errors correctly.
       */
      *end(forceDoc = false, endOffset = -1) {
        if (this.doc) {
          this.decorate(this.doc, true);
          yield this.doc;
          this.doc = null;
        } else if (forceDoc) {
          const opts = Object.assign({ _directives: this.directives }, this.options);
          const doc = new Document.Document(void 0, opts);
          if (this.atDirectives)
            this.onError(endOffset, "MISSING_CHAR", "Missing directives-end indicator line");
          doc.range = [0, endOffset, endOffset];
          this.decorate(doc, false);
          yield doc;
        }
      }
    };
    exports2.Composer = Composer;
  }
});

// ../node_modules/yaml/dist/parse/cst-scalar.js
var require_cst_scalar = __commonJS({
  "../node_modules/yaml/dist/parse/cst-scalar.js"(exports2) {
    "use strict";
    var resolveBlockScalar = require_resolve_block_scalar();
    var resolveFlowScalar = require_resolve_flow_scalar();
    var errors = require_errors();
    var stringifyString = require_stringifyString();
    function resolveAsScalar(token, strict = true, onError) {
      if (token) {
        const _onError = (pos, code, message) => {
          const offset = typeof pos === "number" ? pos : Array.isArray(pos) ? pos[0] : pos.offset;
          if (onError)
            onError(offset, code, message);
          else
            throw new errors.YAMLParseError([offset, offset + 1], code, message);
        };
        switch (token.type) {
          case "scalar":
          case "single-quoted-scalar":
          case "double-quoted-scalar":
            return resolveFlowScalar.resolveFlowScalar(token, strict, _onError);
          case "block-scalar":
            return resolveBlockScalar.resolveBlockScalar({ options: { strict } }, token, _onError);
        }
      }
      return null;
    }
    function createScalarToken(value, context) {
      const { implicitKey = false, indent, inFlow = false, offset = -1, type = "PLAIN" } = context;
      const source = stringifyString.stringifyString({ type, value }, {
        implicitKey,
        indent: indent > 0 ? " ".repeat(indent) : "",
        inFlow,
        options: { blockQuote: true, lineWidth: -1 }
      });
      const end = context.end ?? [
        { type: "newline", offset: -1, indent, source: "\n" }
      ];
      switch (source[0]) {
        case "|":
        case ">": {
          const he = source.indexOf("\n");
          const head = source.substring(0, he);
          const body = source.substring(he + 1) + "\n";
          const props = [
            { type: "block-scalar-header", offset, indent, source: head }
          ];
          if (!addEndtoBlockProps(props, end))
            props.push({ type: "newline", offset: -1, indent, source: "\n" });
          return { type: "block-scalar", offset, indent, props, source: body };
        }
        case '"':
          return { type: "double-quoted-scalar", offset, indent, source, end };
        case "'":
          return { type: "single-quoted-scalar", offset, indent, source, end };
        default:
          return { type: "scalar", offset, indent, source, end };
      }
    }
    function setScalarValue(token, value, context = {}) {
      let { afterKey = false, implicitKey = false, inFlow = false, type } = context;
      let indent = "indent" in token ? token.indent : null;
      if (afterKey && typeof indent === "number")
        indent += 2;
      if (!type)
        switch (token.type) {
          case "single-quoted-scalar":
            type = "QUOTE_SINGLE";
            break;
          case "double-quoted-scalar":
            type = "QUOTE_DOUBLE";
            break;
          case "block-scalar": {
            const header = token.props[0];
            if (header.type !== "block-scalar-header")
              throw new Error("Invalid block scalar header");
            type = header.source[0] === ">" ? "BLOCK_FOLDED" : "BLOCK_LITERAL";
            break;
          }
          default:
            type = "PLAIN";
        }
      const source = stringifyString.stringifyString({ type, value }, {
        implicitKey: implicitKey || indent === null,
        indent: indent !== null && indent > 0 ? " ".repeat(indent) : "",
        inFlow,
        options: { blockQuote: true, lineWidth: -1 }
      });
      switch (source[0]) {
        case "|":
        case ">":
          setBlockScalarValue(token, source);
          break;
        case '"':
          setFlowScalarValue(token, source, "double-quoted-scalar");
          break;
        case "'":
          setFlowScalarValue(token, source, "single-quoted-scalar");
          break;
        default:
          setFlowScalarValue(token, source, "scalar");
      }
    }
    function setBlockScalarValue(token, source) {
      const he = source.indexOf("\n");
      const head = source.substring(0, he);
      const body = source.substring(he + 1) + "\n";
      if (token.type === "block-scalar") {
        const header = token.props[0];
        if (header.type !== "block-scalar-header")
          throw new Error("Invalid block scalar header");
        header.source = head;
        token.source = body;
      } else {
        const { offset } = token;
        const indent = "indent" in token ? token.indent : -1;
        const props = [
          { type: "block-scalar-header", offset, indent, source: head }
        ];
        if (!addEndtoBlockProps(props, "end" in token ? token.end : void 0))
          props.push({ type: "newline", offset: -1, indent, source: "\n" });
        for (const key of Object.keys(token))
          if (key !== "type" && key !== "offset")
            delete token[key];
        Object.assign(token, { type: "block-scalar", indent, props, source: body });
      }
    }
    function addEndtoBlockProps(props, end) {
      if (end)
        for (const st of end)
          switch (st.type) {
            case "space":
            case "comment":
              props.push(st);
              break;
            case "newline":
              props.push(st);
              return true;
          }
      return false;
    }
    function setFlowScalarValue(token, source, type) {
      switch (token.type) {
        case "scalar":
        case "double-quoted-scalar":
        case "single-quoted-scalar":
          token.type = type;
          token.source = source;
          break;
        case "block-scalar": {
          const end = token.props.slice(1);
          let oa = source.length;
          if (token.props[0].type === "block-scalar-header")
            oa -= token.props[0].source.length;
          for (const tok of end)
            tok.offset += oa;
          delete token.props;
          Object.assign(token, { type, source, end });
          break;
        }
        case "block-map":
        case "block-seq": {
          const offset = token.offset + source.length;
          const nl = { type: "newline", offset, indent: token.indent, source: "\n" };
          delete token.items;
          Object.assign(token, { type, source, end: [nl] });
          break;
        }
        default: {
          const indent = "indent" in token ? token.indent : -1;
          const end = "end" in token && Array.isArray(token.end) ? token.end.filter((st) => st.type === "space" || st.type === "comment" || st.type === "newline") : [];
          for (const key of Object.keys(token))
            if (key !== "type" && key !== "offset")
              delete token[key];
          Object.assign(token, { type, indent, source, end });
        }
      }
    }
    exports2.createScalarToken = createScalarToken;
    exports2.resolveAsScalar = resolveAsScalar;
    exports2.setScalarValue = setScalarValue;
  }
});

// ../node_modules/yaml/dist/parse/cst-stringify.js
var require_cst_stringify = __commonJS({
  "../node_modules/yaml/dist/parse/cst-stringify.js"(exports2) {
    "use strict";
    var stringify = (cst) => "type" in cst ? stringifyToken(cst) : stringifyItem(cst);
    function stringifyToken(token) {
      switch (token.type) {
        case "block-scalar": {
          let res = "";
          for (const tok of token.props)
            res += stringifyToken(tok);
          return res + token.source;
        }
        case "block-map":
        case "block-seq": {
          let res = "";
          for (const item of token.items)
            res += stringifyItem(item);
          return res;
        }
        case "flow-collection": {
          let res = token.start.source;
          for (const item of token.items)
            res += stringifyItem(item);
          for (const st of token.end)
            res += st.source;
          return res;
        }
        case "document": {
          let res = stringifyItem(token);
          if (token.end)
            for (const st of token.end)
              res += st.source;
          return res;
        }
        default: {
          let res = token.source;
          if ("end" in token && token.end)
            for (const st of token.end)
              res += st.source;
          return res;
        }
      }
    }
    function stringifyItem({ start, key, sep, value }) {
      let res = "";
      for (const st of start)
        res += st.source;
      if (key)
        res += stringifyToken(key);
      if (sep)
        for (const st of sep)
          res += st.source;
      if (value)
        res += stringifyToken(value);
      return res;
    }
    exports2.stringify = stringify;
  }
});

// ../node_modules/yaml/dist/parse/cst-visit.js
var require_cst_visit = __commonJS({
  "../node_modules/yaml/dist/parse/cst-visit.js"(exports2) {
    "use strict";
    var BREAK = /* @__PURE__ */ Symbol("break visit");
    var SKIP = /* @__PURE__ */ Symbol("skip children");
    var REMOVE = /* @__PURE__ */ Symbol("remove item");
    function visit(cst, visitor) {
      if ("type" in cst && cst.type === "document")
        cst = { start: cst.start, value: cst.value };
      _visit(Object.freeze([]), cst, visitor);
    }
    visit.BREAK = BREAK;
    visit.SKIP = SKIP;
    visit.REMOVE = REMOVE;
    visit.itemAtPath = (cst, path) => {
      let item = cst;
      for (const [field, index] of path) {
        const tok = item?.[field];
        if (tok && "items" in tok) {
          item = tok.items[index];
        } else
          return void 0;
      }
      return item;
    };
    visit.parentCollection = (cst, path) => {
      const parent = visit.itemAtPath(cst, path.slice(0, -1));
      const field = path[path.length - 1][0];
      const coll = parent?.[field];
      if (coll && "items" in coll)
        return coll;
      throw new Error("Parent collection not found");
    };
    function _visit(path, item, visitor) {
      let ctrl = visitor(item, path);
      if (typeof ctrl === "symbol")
        return ctrl;
      for (const field of ["key", "value"]) {
        const token = item[field];
        if (token && "items" in token) {
          for (let i = 0; i < token.items.length; ++i) {
            const ci = _visit(Object.freeze(path.concat([[field, i]])), token.items[i], visitor);
            if (typeof ci === "number")
              i = ci - 1;
            else if (ci === BREAK)
              return BREAK;
            else if (ci === REMOVE) {
              token.items.splice(i, 1);
              i -= 1;
            }
          }
          if (typeof ctrl === "function" && field === "key")
            ctrl = ctrl(item, path);
        }
      }
      return typeof ctrl === "function" ? ctrl(item, path) : ctrl;
    }
    exports2.visit = visit;
  }
});

// ../node_modules/yaml/dist/parse/cst.js
var require_cst = __commonJS({
  "../node_modules/yaml/dist/parse/cst.js"(exports2) {
    "use strict";
    var cstScalar = require_cst_scalar();
    var cstStringify = require_cst_stringify();
    var cstVisit = require_cst_visit();
    var BOM = "\uFEFF";
    var DOCUMENT = "";
    var FLOW_END = "";
    var SCALAR = "";
    var isCollection = (token) => !!token && "items" in token;
    var isScalar = (token) => !!token && (token.type === "scalar" || token.type === "single-quoted-scalar" || token.type === "double-quoted-scalar" || token.type === "block-scalar");
    function prettyToken(token) {
      switch (token) {
        case BOM:
          return "<BOM>";
        case DOCUMENT:
          return "<DOC>";
        case FLOW_END:
          return "<FLOW_END>";
        case SCALAR:
          return "<SCALAR>";
        default:
          return JSON.stringify(token);
      }
    }
    function tokenType(source) {
      switch (source) {
        case BOM:
          return "byte-order-mark";
        case DOCUMENT:
          return "doc-mode";
        case FLOW_END:
          return "flow-error-end";
        case SCALAR:
          return "scalar";
        case "---":
          return "doc-start";
        case "...":
          return "doc-end";
        case "":
        case "\n":
        case "\r\n":
          return "newline";
        case "-":
          return "seq-item-ind";
        case "?":
          return "explicit-key-ind";
        case ":":
          return "map-value-ind";
        case "{":
          return "flow-map-start";
        case "}":
          return "flow-map-end";
        case "[":
          return "flow-seq-start";
        case "]":
          return "flow-seq-end";
        case ",":
          return "comma";
      }
      switch (source[0]) {
        case " ":
        case "	":
          return "space";
        case "#":
          return "comment";
        case "%":
          return "directive-line";
        case "*":
          return "alias";
        case "&":
          return "anchor";
        case "!":
          return "tag";
        case "'":
          return "single-quoted-scalar";
        case '"':
          return "double-quoted-scalar";
        case "|":
        case ">":
          return "block-scalar-header";
      }
      return null;
    }
    exports2.createScalarToken = cstScalar.createScalarToken;
    exports2.resolveAsScalar = cstScalar.resolveAsScalar;
    exports2.setScalarValue = cstScalar.setScalarValue;
    exports2.stringify = cstStringify.stringify;
    exports2.visit = cstVisit.visit;
    exports2.BOM = BOM;
    exports2.DOCUMENT = DOCUMENT;
    exports2.FLOW_END = FLOW_END;
    exports2.SCALAR = SCALAR;
    exports2.isCollection = isCollection;
    exports2.isScalar = isScalar;
    exports2.prettyToken = prettyToken;
    exports2.tokenType = tokenType;
  }
});

// ../node_modules/yaml/dist/parse/lexer.js
var require_lexer = __commonJS({
  "../node_modules/yaml/dist/parse/lexer.js"(exports2) {
    "use strict";
    var cst = require_cst();
    function isEmpty(ch) {
      switch (ch) {
        case void 0:
        case " ":
        case "\n":
        case "\r":
        case "	":
          return true;
        default:
          return false;
      }
    }
    var hexDigits = new Set("0123456789ABCDEFabcdef");
    var tagChars = new Set("0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz-#;/?:@&=+$_.!~*'()");
    var flowIndicatorChars = new Set(",[]{}");
    var invalidAnchorChars = new Set(" ,[]{}\n\r	");
    var isNotAnchorChar = (ch) => !ch || invalidAnchorChars.has(ch);
    var Lexer = class {
      constructor() {
        this.atEnd = false;
        this.blockScalarIndent = -1;
        this.blockScalarKeep = false;
        this.buffer = "";
        this.flowKey = false;
        this.flowLevel = 0;
        this.indentNext = 0;
        this.indentValue = 0;
        this.lineEndPos = null;
        this.next = null;
        this.pos = 0;
      }
      /**
       * Generate YAML tokens from the `source` string. If `incomplete`,
       * a part of the last line may be left as a buffer for the next call.
       *
       * @returns A generator of lexical tokens
       */
      *lex(source, incomplete = false) {
        if (source) {
          if (typeof source !== "string")
            throw TypeError("source is not a string");
          this.buffer = this.buffer ? this.buffer + source : source;
          this.lineEndPos = null;
        }
        this.atEnd = !incomplete;
        let next = this.next ?? "stream";
        while (next && (incomplete || this.hasChars(1)))
          next = yield* this.parseNext(next);
      }
      atLineEnd() {
        let i = this.pos;
        let ch = this.buffer[i];
        while (ch === " " || ch === "	")
          ch = this.buffer[++i];
        if (!ch || ch === "#" || ch === "\n")
          return true;
        if (ch === "\r")
          return this.buffer[i + 1] === "\n";
        return false;
      }
      charAt(n) {
        return this.buffer[this.pos + n];
      }
      continueScalar(offset) {
        let ch = this.buffer[offset];
        if (this.indentNext > 0) {
          let indent = 0;
          while (ch === " ")
            ch = this.buffer[++indent + offset];
          if (ch === "\r") {
            const next = this.buffer[indent + offset + 1];
            if (next === "\n" || !next && !this.atEnd)
              return offset + indent + 1;
          }
          return ch === "\n" || indent >= this.indentNext || !ch && !this.atEnd ? offset + indent : -1;
        }
        if (ch === "-" || ch === ".") {
          const dt = this.buffer.substr(offset, 3);
          if ((dt === "---" || dt === "...") && isEmpty(this.buffer[offset + 3]))
            return -1;
        }
        return offset;
      }
      getLine() {
        let end = this.lineEndPos;
        if (typeof end !== "number" || end !== -1 && end < this.pos) {
          end = this.buffer.indexOf("\n", this.pos);
          this.lineEndPos = end;
        }
        if (end === -1)
          return this.atEnd ? this.buffer.substring(this.pos) : null;
        if (this.buffer[end - 1] === "\r")
          end -= 1;
        return this.buffer.substring(this.pos, end);
      }
      hasChars(n) {
        return this.pos + n <= this.buffer.length;
      }
      setNext(state) {
        this.buffer = this.buffer.substring(this.pos);
        this.pos = 0;
        this.lineEndPos = null;
        this.next = state;
        return null;
      }
      peek(n) {
        return this.buffer.substr(this.pos, n);
      }
      *parseNext(next) {
        switch (next) {
          case "stream":
            return yield* this.parseStream();
          case "line-start":
            return yield* this.parseLineStart();
          case "block-start":
            return yield* this.parseBlockStart();
          case "doc":
            return yield* this.parseDocument();
          case "flow":
            return yield* this.parseFlowCollection();
          case "quoted-scalar":
            return yield* this.parseQuotedScalar();
          case "block-scalar":
            return yield* this.parseBlockScalar();
          case "plain-scalar":
            return yield* this.parsePlainScalar();
        }
      }
      *parseStream() {
        let line = this.getLine();
        if (line === null)
          return this.setNext("stream");
        if (line[0] === cst.BOM) {
          yield* this.pushCount(1);
          line = line.substring(1);
        }
        if (line[0] === "%") {
          let dirEnd = line.length;
          let cs = line.indexOf("#");
          while (cs !== -1) {
            const ch = line[cs - 1];
            if (ch === " " || ch === "	") {
              dirEnd = cs - 1;
              break;
            } else {
              cs = line.indexOf("#", cs + 1);
            }
          }
          while (true) {
            const ch = line[dirEnd - 1];
            if (ch === " " || ch === "	")
              dirEnd -= 1;
            else
              break;
          }
          const n = (yield* this.pushCount(dirEnd)) + (yield* this.pushSpaces(true));
          yield* this.pushCount(line.length - n);
          this.pushNewline();
          return "stream";
        }
        if (this.atLineEnd()) {
          const sp = yield* this.pushSpaces(true);
          yield* this.pushCount(line.length - sp);
          yield* this.pushNewline();
          return "stream";
        }
        yield cst.DOCUMENT;
        return yield* this.parseLineStart();
      }
      *parseLineStart() {
        const ch = this.charAt(0);
        if (!ch && !this.atEnd)
          return this.setNext("line-start");
        if (ch === "-" || ch === ".") {
          if (!this.atEnd && !this.hasChars(4))
            return this.setNext("line-start");
          const s = this.peek(3);
          if ((s === "---" || s === "...") && isEmpty(this.charAt(3))) {
            yield* this.pushCount(3);
            this.indentValue = 0;
            this.indentNext = 0;
            return s === "---" ? "doc" : "stream";
          }
        }
        this.indentValue = yield* this.pushSpaces(false);
        if (this.indentNext > this.indentValue && !isEmpty(this.charAt(1)))
          this.indentNext = this.indentValue;
        return yield* this.parseBlockStart();
      }
      *parseBlockStart() {
        const [ch0, ch1] = this.peek(2);
        if (!ch1 && !this.atEnd)
          return this.setNext("block-start");
        if ((ch0 === "-" || ch0 === "?" || ch0 === ":") && isEmpty(ch1)) {
          const n = (yield* this.pushCount(1)) + (yield* this.pushSpaces(true));
          this.indentNext = this.indentValue + 1;
          this.indentValue += n;
          return "block-start";
        }
        return "doc";
      }
      *parseDocument() {
        yield* this.pushSpaces(true);
        const line = this.getLine();
        if (line === null)
          return this.setNext("doc");
        let n = yield* this.pushIndicators();
        switch (line[n]) {
          case "#":
            yield* this.pushCount(line.length - n);
          // fallthrough
          case void 0:
            yield* this.pushNewline();
            return yield* this.parseLineStart();
          case "{":
          case "[":
            yield* this.pushCount(1);
            this.flowKey = false;
            this.flowLevel = 1;
            return "flow";
          case "}":
          case "]":
            yield* this.pushCount(1);
            return "doc";
          case "*":
            yield* this.pushUntil(isNotAnchorChar);
            return "doc";
          case '"':
          case "'":
            return yield* this.parseQuotedScalar();
          case "|":
          case ">":
            n += yield* this.parseBlockScalarHeader();
            n += yield* this.pushSpaces(true);
            yield* this.pushCount(line.length - n);
            yield* this.pushNewline();
            return yield* this.parseBlockScalar();
          default:
            return yield* this.parsePlainScalar();
        }
      }
      *parseFlowCollection() {
        let nl, sp;
        let indent = -1;
        do {
          nl = yield* this.pushNewline();
          if (nl > 0) {
            sp = yield* this.pushSpaces(false);
            this.indentValue = indent = sp;
          } else {
            sp = 0;
          }
          sp += yield* this.pushSpaces(true);
        } while (nl + sp > 0);
        const line = this.getLine();
        if (line === null)
          return this.setNext("flow");
        if (indent !== -1 && indent < this.indentNext && line[0] !== "#" || indent === 0 && (line.startsWith("---") || line.startsWith("...")) && isEmpty(line[3])) {
          const atFlowEndMarker = indent === this.indentNext - 1 && this.flowLevel === 1 && (line[0] === "]" || line[0] === "}");
          if (!atFlowEndMarker) {
            this.flowLevel = 0;
            yield cst.FLOW_END;
            return yield* this.parseLineStart();
          }
        }
        let n = 0;
        while (line[n] === ",") {
          n += yield* this.pushCount(1);
          n += yield* this.pushSpaces(true);
          this.flowKey = false;
        }
        n += yield* this.pushIndicators();
        switch (line[n]) {
          case void 0:
            return "flow";
          case "#":
            yield* this.pushCount(line.length - n);
            return "flow";
          case "{":
          case "[":
            yield* this.pushCount(1);
            this.flowKey = false;
            this.flowLevel += 1;
            return "flow";
          case "}":
          case "]":
            yield* this.pushCount(1);
            this.flowKey = true;
            this.flowLevel -= 1;
            return this.flowLevel ? "flow" : "doc";
          case "*":
            yield* this.pushUntil(isNotAnchorChar);
            return "flow";
          case '"':
          case "'":
            this.flowKey = true;
            return yield* this.parseQuotedScalar();
          case ":": {
            const next = this.charAt(1);
            if (this.flowKey || isEmpty(next) || next === ",") {
              this.flowKey = false;
              yield* this.pushCount(1);
              yield* this.pushSpaces(true);
              return "flow";
            }
          }
          // fallthrough
          default:
            this.flowKey = false;
            return yield* this.parsePlainScalar();
        }
      }
      *parseQuotedScalar() {
        const quote = this.charAt(0);
        let end = this.buffer.indexOf(quote, this.pos + 1);
        if (quote === "'") {
          while (end !== -1 && this.buffer[end + 1] === "'")
            end = this.buffer.indexOf("'", end + 2);
        } else {
          while (end !== -1) {
            let n = 0;
            while (this.buffer[end - 1 - n] === "\\")
              n += 1;
            if (n % 2 === 0)
              break;
            end = this.buffer.indexOf('"', end + 1);
          }
        }
        const qb = this.buffer.substring(0, end);
        let nl = qb.indexOf("\n", this.pos);
        if (nl !== -1) {
          while (nl !== -1) {
            const cs = this.continueScalar(nl + 1);
            if (cs === -1)
              break;
            nl = qb.indexOf("\n", cs);
          }
          if (nl !== -1) {
            end = nl - (qb[nl - 1] === "\r" ? 2 : 1);
          }
        }
        if (end === -1) {
          if (!this.atEnd)
            return this.setNext("quoted-scalar");
          end = this.buffer.length;
        }
        yield* this.pushToIndex(end + 1, false);
        return this.flowLevel ? "flow" : "doc";
      }
      *parseBlockScalarHeader() {
        this.blockScalarIndent = -1;
        this.blockScalarKeep = false;
        let i = this.pos;
        while (true) {
          const ch = this.buffer[++i];
          if (ch === "+")
            this.blockScalarKeep = true;
          else if (ch > "0" && ch <= "9")
            this.blockScalarIndent = Number(ch) - 1;
          else if (ch !== "-")
            break;
        }
        return yield* this.pushUntil((ch) => isEmpty(ch) || ch === "#");
      }
      *parseBlockScalar() {
        let nl = this.pos - 1;
        let indent = 0;
        let ch;
        loop: for (let i2 = this.pos; ch = this.buffer[i2]; ++i2) {
          switch (ch) {
            case " ":
              indent += 1;
              break;
            case "\n":
              nl = i2;
              indent = 0;
              break;
            case "\r": {
              const next = this.buffer[i2 + 1];
              if (!next && !this.atEnd)
                return this.setNext("block-scalar");
              if (next === "\n")
                break;
            }
            // fallthrough
            default:
              break loop;
          }
        }
        if (!ch && !this.atEnd)
          return this.setNext("block-scalar");
        if (indent >= this.indentNext) {
          if (this.blockScalarIndent === -1)
            this.indentNext = indent;
          else {
            this.indentNext = this.blockScalarIndent + (this.indentNext === 0 ? 1 : this.indentNext);
          }
          do {
            const cs = this.continueScalar(nl + 1);
            if (cs === -1)
              break;
            nl = this.buffer.indexOf("\n", cs);
          } while (nl !== -1);
          if (nl === -1) {
            if (!this.atEnd)
              return this.setNext("block-scalar");
            nl = this.buffer.length;
          }
        }
        let i = nl + 1;
        ch = this.buffer[i];
        while (ch === " ")
          ch = this.buffer[++i];
        if (ch === "	") {
          while (ch === "	" || ch === " " || ch === "\r" || ch === "\n")
            ch = this.buffer[++i];
          nl = i - 1;
        } else if (!this.blockScalarKeep) {
          do {
            let i2 = nl - 1;
            let ch2 = this.buffer[i2];
            if (ch2 === "\r")
              ch2 = this.buffer[--i2];
            const lastChar = i2;
            while (ch2 === " ")
              ch2 = this.buffer[--i2];
            if (ch2 === "\n" && i2 >= this.pos && i2 + 1 + indent > lastChar)
              nl = i2;
            else
              break;
          } while (true);
        }
        yield cst.SCALAR;
        yield* this.pushToIndex(nl + 1, true);
        return yield* this.parseLineStart();
      }
      *parsePlainScalar() {
        const inFlow = this.flowLevel > 0;
        let end = this.pos - 1;
        let i = this.pos - 1;
        let ch;
        while (ch = this.buffer[++i]) {
          if (ch === ":") {
            const next = this.buffer[i + 1];
            if (isEmpty(next) || inFlow && flowIndicatorChars.has(next))
              break;
            end = i;
          } else if (isEmpty(ch)) {
            let next = this.buffer[i + 1];
            if (ch === "\r") {
              if (next === "\n") {
                i += 1;
                ch = "\n";
                next = this.buffer[i + 1];
              } else
                end = i;
            }
            if (next === "#" || inFlow && flowIndicatorChars.has(next))
              break;
            if (ch === "\n") {
              const cs = this.continueScalar(i + 1);
              if (cs === -1)
                break;
              i = Math.max(i, cs - 2);
            }
          } else {
            if (inFlow && flowIndicatorChars.has(ch))
              break;
            end = i;
          }
        }
        if (!ch && !this.atEnd)
          return this.setNext("plain-scalar");
        yield cst.SCALAR;
        yield* this.pushToIndex(end + 1, true);
        return inFlow ? "flow" : "doc";
      }
      *pushCount(n) {
        if (n > 0) {
          yield this.buffer.substr(this.pos, n);
          this.pos += n;
          return n;
        }
        return 0;
      }
      *pushToIndex(i, allowEmpty) {
        const s = this.buffer.slice(this.pos, i);
        if (s) {
          yield s;
          this.pos += s.length;
          return s.length;
        } else if (allowEmpty)
          yield "";
        return 0;
      }
      *pushIndicators() {
        let n = 0;
        loop: while (true) {
          switch (this.charAt(0)) {
            case "!":
              n += yield* this.pushTag();
              n += yield* this.pushSpaces(true);
              continue loop;
            case "&":
              n += yield* this.pushUntil(isNotAnchorChar);
              n += yield* this.pushSpaces(true);
              continue loop;
            case "-":
            // this is an error
            case "?":
            // this is an error outside flow collections
            case ":": {
              const inFlow = this.flowLevel > 0;
              const ch1 = this.charAt(1);
              if (isEmpty(ch1) || inFlow && flowIndicatorChars.has(ch1)) {
                if (!inFlow)
                  this.indentNext = this.indentValue + 1;
                else if (this.flowKey)
                  this.flowKey = false;
                n += yield* this.pushCount(1);
                n += yield* this.pushSpaces(true);
                continue loop;
              }
            }
          }
          break loop;
        }
        return n;
      }
      *pushTag() {
        if (this.charAt(1) === "<") {
          let i = this.pos + 2;
          let ch = this.buffer[i];
          while (!isEmpty(ch) && ch !== ">")
            ch = this.buffer[++i];
          return yield* this.pushToIndex(ch === ">" ? i + 1 : i, false);
        } else {
          let i = this.pos + 1;
          let ch = this.buffer[i];
          while (ch) {
            if (tagChars.has(ch))
              ch = this.buffer[++i];
            else if (ch === "%" && hexDigits.has(this.buffer[i + 1]) && hexDigits.has(this.buffer[i + 2])) {
              ch = this.buffer[i += 3];
            } else
              break;
          }
          return yield* this.pushToIndex(i, false);
        }
      }
      *pushNewline() {
        const ch = this.buffer[this.pos];
        if (ch === "\n")
          return yield* this.pushCount(1);
        else if (ch === "\r" && this.charAt(1) === "\n")
          return yield* this.pushCount(2);
        else
          return 0;
      }
      *pushSpaces(allowTabs) {
        let i = this.pos - 1;
        let ch;
        do {
          ch = this.buffer[++i];
        } while (ch === " " || allowTabs && ch === "	");
        const n = i - this.pos;
        if (n > 0) {
          yield this.buffer.substr(this.pos, n);
          this.pos = i;
        }
        return n;
      }
      *pushUntil(test) {
        let i = this.pos;
        let ch = this.buffer[i];
        while (!test(ch))
          ch = this.buffer[++i];
        return yield* this.pushToIndex(i, false);
      }
    };
    exports2.Lexer = Lexer;
  }
});

// ../node_modules/yaml/dist/parse/line-counter.js
var require_line_counter = __commonJS({
  "../node_modules/yaml/dist/parse/line-counter.js"(exports2) {
    "use strict";
    var LineCounter = class {
      constructor() {
        this.lineStarts = [];
        this.addNewLine = (offset) => this.lineStarts.push(offset);
        this.linePos = (offset) => {
          let low = 0;
          let high = this.lineStarts.length;
          while (low < high) {
            const mid = low + high >> 1;
            if (this.lineStarts[mid] < offset)
              low = mid + 1;
            else
              high = mid;
          }
          if (this.lineStarts[low] === offset)
            return { line: low + 1, col: 1 };
          if (low === 0)
            return { line: 0, col: offset };
          const start = this.lineStarts[low - 1];
          return { line: low, col: offset - start + 1 };
        };
      }
    };
    exports2.LineCounter = LineCounter;
  }
});

// ../node_modules/yaml/dist/parse/parser.js
var require_parser = __commonJS({
  "../node_modules/yaml/dist/parse/parser.js"(exports2) {
    "use strict";
    var node_process = require("process");
    var cst = require_cst();
    var lexer = require_lexer();
    function includesToken(list, type) {
      for (let i = 0; i < list.length; ++i)
        if (list[i].type === type)
          return true;
      return false;
    }
    function findNonEmptyIndex(list) {
      for (let i = 0; i < list.length; ++i) {
        switch (list[i].type) {
          case "space":
          case "comment":
          case "newline":
            break;
          default:
            return i;
        }
      }
      return -1;
    }
    function isFlowToken(token) {
      switch (token?.type) {
        case "alias":
        case "scalar":
        case "single-quoted-scalar":
        case "double-quoted-scalar":
        case "flow-collection":
          return true;
        default:
          return false;
      }
    }
    function getPrevProps(parent) {
      switch (parent.type) {
        case "document":
          return parent.start;
        case "block-map": {
          const it = parent.items[parent.items.length - 1];
          return it.sep ?? it.start;
        }
        case "block-seq":
          return parent.items[parent.items.length - 1].start;
        /* istanbul ignore next should not happen */
        default:
          return [];
      }
    }
    function getFirstKeyStartProps(prev) {
      if (prev.length === 0)
        return [];
      let i = prev.length;
      loop: while (--i >= 0) {
        switch (prev[i].type) {
          case "doc-start":
          case "explicit-key-ind":
          case "map-value-ind":
          case "seq-item-ind":
          case "newline":
            break loop;
        }
      }
      while (prev[++i]?.type === "space") {
      }
      return prev.splice(i, prev.length);
    }
    function arrayPushArray(target, source) {
      if (source.length < 1e5)
        Array.prototype.push.apply(target, source);
      else
        for (let i = 0; i < source.length; ++i)
          target.push(source[i]);
    }
    function fixFlowSeqItems(fc) {
      if (fc.start.type === "flow-seq-start") {
        for (const it of fc.items) {
          if (it.sep && !it.value && !includesToken(it.start, "explicit-key-ind") && !includesToken(it.sep, "map-value-ind")) {
            if (it.key)
              it.value = it.key;
            delete it.key;
            if (isFlowToken(it.value)) {
              if (it.value.end)
                arrayPushArray(it.value.end, it.sep);
              else
                it.value.end = it.sep;
            } else
              arrayPushArray(it.start, it.sep);
            delete it.sep;
          }
        }
      }
    }
    var Parser = class {
      /**
       * @param onNewLine - If defined, called separately with the start position of
       *   each new line (in `parse()`, including the start of input).
       */
      constructor(onNewLine) {
        this.atNewLine = true;
        this.atScalar = false;
        this.indent = 0;
        this.offset = 0;
        this.onKeyLine = false;
        this.stack = [];
        this.source = "";
        this.type = "";
        this.lexer = new lexer.Lexer();
        this.onNewLine = onNewLine;
      }
      /**
       * Parse `source` as a YAML stream.
       * If `incomplete`, a part of the last line may be left as a buffer for the next call.
       *
       * Errors are not thrown, but yielded as `{ type: 'error', message }` tokens.
       *
       * @returns A generator of tokens representing each directive, document, and other structure.
       */
      *parse(source, incomplete = false) {
        if (this.onNewLine && this.offset === 0)
          this.onNewLine(0);
        for (const lexeme of this.lexer.lex(source, incomplete))
          yield* this.next(lexeme);
        if (!incomplete)
          yield* this.end();
      }
      /**
       * Advance the parser by the `source` of one lexical token.
       */
      *next(source) {
        this.source = source;
        if (node_process.env.LOG_TOKENS)
          console.log("|", cst.prettyToken(source));
        if (this.atScalar) {
          this.atScalar = false;
          yield* this.step();
          this.offset += source.length;
          return;
        }
        const type = cst.tokenType(source);
        if (!type) {
          const message = `Not a YAML token: ${source}`;
          yield* this.pop({ type: "error", offset: this.offset, message, source });
          this.offset += source.length;
        } else if (type === "scalar") {
          this.atNewLine = false;
          this.atScalar = true;
          this.type = "scalar";
        } else {
          this.type = type;
          yield* this.step();
          switch (type) {
            case "newline":
              this.atNewLine = true;
              this.indent = 0;
              if (this.onNewLine)
                this.onNewLine(this.offset + source.length);
              break;
            case "space":
              if (this.atNewLine && source[0] === " ")
                this.indent += source.length;
              break;
            case "explicit-key-ind":
            case "map-value-ind":
            case "seq-item-ind":
              if (this.atNewLine)
                this.indent += source.length;
              break;
            case "doc-mode":
            case "flow-error-end":
              return;
            default:
              this.atNewLine = false;
          }
          this.offset += source.length;
        }
      }
      /** Call at end of input to push out any remaining constructions */
      *end() {
        while (this.stack.length > 0)
          yield* this.pop();
      }
      get sourceToken() {
        const st = {
          type: this.type,
          offset: this.offset,
          indent: this.indent,
          source: this.source
        };
        return st;
      }
      *step() {
        const top = this.peek(1);
        if (this.type === "doc-end" && top?.type !== "doc-end") {
          while (this.stack.length > 0)
            yield* this.pop();
          this.stack.push({
            type: "doc-end",
            offset: this.offset,
            source: this.source
          });
          return;
        }
        if (!top)
          return yield* this.stream();
        switch (top.type) {
          case "document":
            return yield* this.document(top);
          case "alias":
          case "scalar":
          case "single-quoted-scalar":
          case "double-quoted-scalar":
            return yield* this.scalar(top);
          case "block-scalar":
            return yield* this.blockScalar(top);
          case "block-map":
            return yield* this.blockMap(top);
          case "block-seq":
            return yield* this.blockSequence(top);
          case "flow-collection":
            return yield* this.flowCollection(top);
          case "doc-end":
            return yield* this.documentEnd(top);
        }
        yield* this.pop();
      }
      peek(n) {
        return this.stack[this.stack.length - n];
      }
      *pop(error) {
        const token = error ?? this.stack.pop();
        if (!token) {
          const message = "Tried to pop an empty stack";
          yield { type: "error", offset: this.offset, source: "", message };
        } else if (this.stack.length === 0) {
          yield token;
        } else {
          const top = this.peek(1);
          if (token.type === "block-scalar") {
            token.indent = "indent" in top ? top.indent : 0;
          } else if (token.type === "flow-collection" && top.type === "document") {
            token.indent = 0;
          }
          if (token.type === "flow-collection")
            fixFlowSeqItems(token);
          switch (top.type) {
            case "document":
              top.value = token;
              break;
            case "block-scalar":
              top.props.push(token);
              break;
            case "block-map": {
              const it = top.items[top.items.length - 1];
              if (it.value) {
                top.items.push({ start: [], key: token, sep: [] });
                this.onKeyLine = true;
                return;
              } else if (it.sep) {
                it.value = token;
              } else {
                Object.assign(it, { key: token, sep: [] });
                this.onKeyLine = !it.explicitKey;
                return;
              }
              break;
            }
            case "block-seq": {
              const it = top.items[top.items.length - 1];
              if (it.value)
                top.items.push({ start: [], value: token });
              else
                it.value = token;
              break;
            }
            case "flow-collection": {
              const it = top.items[top.items.length - 1];
              if (!it || it.value)
                top.items.push({ start: [], key: token, sep: [] });
              else if (it.sep)
                it.value = token;
              else
                Object.assign(it, { key: token, sep: [] });
              return;
            }
            /* istanbul ignore next should not happen */
            default:
              yield* this.pop();
              yield* this.pop(token);
          }
          if ((top.type === "document" || top.type === "block-map" || top.type === "block-seq") && (token.type === "block-map" || token.type === "block-seq")) {
            const last = token.items[token.items.length - 1];
            if (last && !last.sep && !last.value && last.start.length > 0 && findNonEmptyIndex(last.start) === -1 && (token.indent === 0 || last.start.every((st) => st.type !== "comment" || st.indent < token.indent))) {
              if (top.type === "document")
                top.end = last.start;
              else
                top.items.push({ start: last.start });
              token.items.splice(-1, 1);
            }
          }
        }
      }
      *stream() {
        switch (this.type) {
          case "directive-line":
            yield { type: "directive", offset: this.offset, source: this.source };
            return;
          case "byte-order-mark":
          case "space":
          case "comment":
          case "newline":
            yield this.sourceToken;
            return;
          case "doc-mode":
          case "doc-start": {
            const doc = {
              type: "document",
              offset: this.offset,
              start: []
            };
            if (this.type === "doc-start")
              doc.start.push(this.sourceToken);
            this.stack.push(doc);
            return;
          }
        }
        yield {
          type: "error",
          offset: this.offset,
          message: `Unexpected ${this.type} token in YAML stream`,
          source: this.source
        };
      }
      *document(doc) {
        if (doc.value)
          return yield* this.lineEnd(doc);
        switch (this.type) {
          case "doc-start": {
            if (findNonEmptyIndex(doc.start) !== -1) {
              yield* this.pop();
              yield* this.step();
            } else
              doc.start.push(this.sourceToken);
            return;
          }
          case "anchor":
          case "tag":
          case "space":
          case "comment":
          case "newline":
            doc.start.push(this.sourceToken);
            return;
        }
        const bv = this.startBlockValue(doc);
        if (bv)
          this.stack.push(bv);
        else {
          yield {
            type: "error",
            offset: this.offset,
            message: `Unexpected ${this.type} token in YAML document`,
            source: this.source
          };
        }
      }
      *scalar(scalar) {
        if (this.type === "map-value-ind") {
          const prev = getPrevProps(this.peek(2));
          const start = getFirstKeyStartProps(prev);
          let sep;
          if (scalar.end) {
            sep = scalar.end;
            sep.push(this.sourceToken);
            delete scalar.end;
          } else
            sep = [this.sourceToken];
          const map = {
            type: "block-map",
            offset: scalar.offset,
            indent: scalar.indent,
            items: [{ start, key: scalar, sep }]
          };
          this.onKeyLine = true;
          this.stack[this.stack.length - 1] = map;
        } else
          yield* this.lineEnd(scalar);
      }
      *blockScalar(scalar) {
        switch (this.type) {
          case "space":
          case "comment":
          case "newline":
            scalar.props.push(this.sourceToken);
            return;
          case "scalar":
            scalar.source = this.source;
            this.atNewLine = true;
            this.indent = 0;
            if (this.onNewLine) {
              let nl = this.source.indexOf("\n") + 1;
              while (nl !== 0) {
                this.onNewLine(this.offset + nl);
                nl = this.source.indexOf("\n", nl) + 1;
              }
            }
            yield* this.pop();
            break;
          /* istanbul ignore next should not happen */
          default:
            yield* this.pop();
            yield* this.step();
        }
      }
      *blockMap(map) {
        const it = map.items[map.items.length - 1];
        switch (this.type) {
          case "newline":
            this.onKeyLine = false;
            if (it.value) {
              const end = "end" in it.value ? it.value.end : void 0;
              const last = Array.isArray(end) ? end[end.length - 1] : void 0;
              if (last?.type === "comment")
                end?.push(this.sourceToken);
              else
                map.items.push({ start: [this.sourceToken] });
            } else if (it.sep) {
              it.sep.push(this.sourceToken);
            } else {
              it.start.push(this.sourceToken);
            }
            return;
          case "space":
          case "comment":
            if (it.value) {
              map.items.push({ start: [this.sourceToken] });
            } else if (it.sep) {
              it.sep.push(this.sourceToken);
            } else {
              if (this.atIndentedComment(it.start, map.indent)) {
                const prev = map.items[map.items.length - 2];
                const end = prev?.value?.end;
                if (Array.isArray(end)) {
                  arrayPushArray(end, it.start);
                  end.push(this.sourceToken);
                  map.items.pop();
                  return;
                }
              }
              it.start.push(this.sourceToken);
            }
            return;
        }
        if (this.indent >= map.indent) {
          const atMapIndent = !this.onKeyLine && this.indent === map.indent;
          const atNextItem = atMapIndent && (it.sep || it.explicitKey) && this.type !== "seq-item-ind";
          let start = [];
          if (atNextItem && it.sep && !it.value) {
            const nl = [];
            for (let i = 0; i < it.sep.length; ++i) {
              const st = it.sep[i];
              switch (st.type) {
                case "newline":
                  nl.push(i);
                  break;
                case "space":
                  break;
                case "comment":
                  if (st.indent > map.indent)
                    nl.length = 0;
                  break;
                default:
                  nl.length = 0;
              }
            }
            if (nl.length >= 2)
              start = it.sep.splice(nl[1]);
          }
          switch (this.type) {
            case "anchor":
            case "tag":
              if (atNextItem || it.value) {
                start.push(this.sourceToken);
                map.items.push({ start });
                this.onKeyLine = true;
              } else if (it.sep) {
                it.sep.push(this.sourceToken);
              } else {
                it.start.push(this.sourceToken);
              }
              return;
            case "explicit-key-ind":
              if (!it.sep && !it.explicitKey) {
                it.start.push(this.sourceToken);
                it.explicitKey = true;
              } else if (atNextItem || it.value) {
                start.push(this.sourceToken);
                map.items.push({ start, explicitKey: true });
              } else {
                this.stack.push({
                  type: "block-map",
                  offset: this.offset,
                  indent: this.indent,
                  items: [{ start: [this.sourceToken], explicitKey: true }]
                });
              }
              this.onKeyLine = true;
              return;
            case "map-value-ind":
              if (it.explicitKey) {
                if (!it.sep) {
                  if (includesToken(it.start, "newline")) {
                    Object.assign(it, { key: null, sep: [this.sourceToken] });
                  } else {
                    const start2 = getFirstKeyStartProps(it.start);
                    this.stack.push({
                      type: "block-map",
                      offset: this.offset,
                      indent: this.indent,
                      items: [{ start: start2, key: null, sep: [this.sourceToken] }]
                    });
                  }
                } else if (it.value) {
                  map.items.push({ start: [], key: null, sep: [this.sourceToken] });
                } else if (includesToken(it.sep, "map-value-ind")) {
                  this.stack.push({
                    type: "block-map",
                    offset: this.offset,
                    indent: this.indent,
                    items: [{ start, key: null, sep: [this.sourceToken] }]
                  });
                } else if (isFlowToken(it.key) && !includesToken(it.sep, "newline")) {
                  const start2 = getFirstKeyStartProps(it.start);
                  const key = it.key;
                  const sep = it.sep;
                  sep.push(this.sourceToken);
                  delete it.key;
                  delete it.sep;
                  this.stack.push({
                    type: "block-map",
                    offset: this.offset,
                    indent: this.indent,
                    items: [{ start: start2, key, sep }]
                  });
                } else if (start.length > 0) {
                  it.sep = it.sep.concat(start, this.sourceToken);
                } else {
                  it.sep.push(this.sourceToken);
                }
              } else {
                if (!it.sep) {
                  Object.assign(it, { key: null, sep: [this.sourceToken] });
                } else if (it.value || atNextItem) {
                  map.items.push({ start, key: null, sep: [this.sourceToken] });
                } else if (includesToken(it.sep, "map-value-ind")) {
                  this.stack.push({
                    type: "block-map",
                    offset: this.offset,
                    indent: this.indent,
                    items: [{ start: [], key: null, sep: [this.sourceToken] }]
                  });
                } else {
                  it.sep.push(this.sourceToken);
                }
              }
              this.onKeyLine = true;
              return;
            case "alias":
            case "scalar":
            case "single-quoted-scalar":
            case "double-quoted-scalar": {
              const fs = this.flowScalar(this.type);
              if (atNextItem || it.value) {
                map.items.push({ start, key: fs, sep: [] });
                this.onKeyLine = true;
              } else if (it.sep) {
                this.stack.push(fs);
              } else {
                Object.assign(it, { key: fs, sep: [] });
                this.onKeyLine = true;
              }
              return;
            }
            default: {
              const bv = this.startBlockValue(map);
              if (bv) {
                if (bv.type === "block-seq") {
                  if (!it.explicitKey && it.sep && !includesToken(it.sep, "newline")) {
                    yield* this.pop({
                      type: "error",
                      offset: this.offset,
                      message: "Unexpected block-seq-ind on same line with key",
                      source: this.source
                    });
                    return;
                  }
                } else if (atMapIndent) {
                  map.items.push({ start });
                }
                this.stack.push(bv);
                return;
              }
            }
          }
        }
        yield* this.pop();
        yield* this.step();
      }
      *blockSequence(seq) {
        const it = seq.items[seq.items.length - 1];
        switch (this.type) {
          case "newline":
            if (it.value) {
              const end = "end" in it.value ? it.value.end : void 0;
              const last = Array.isArray(end) ? end[end.length - 1] : void 0;
              if (last?.type === "comment")
                end?.push(this.sourceToken);
              else
                seq.items.push({ start: [this.sourceToken] });
            } else
              it.start.push(this.sourceToken);
            return;
          case "space":
          case "comment":
            if (it.value)
              seq.items.push({ start: [this.sourceToken] });
            else {
              if (this.atIndentedComment(it.start, seq.indent)) {
                const prev = seq.items[seq.items.length - 2];
                const end = prev?.value?.end;
                if (Array.isArray(end)) {
                  arrayPushArray(end, it.start);
                  end.push(this.sourceToken);
                  seq.items.pop();
                  return;
                }
              }
              it.start.push(this.sourceToken);
            }
            return;
          case "anchor":
          case "tag":
            if (it.value || this.indent <= seq.indent)
              break;
            it.start.push(this.sourceToken);
            return;
          case "seq-item-ind":
            if (this.indent !== seq.indent)
              break;
            if (it.value || includesToken(it.start, "seq-item-ind"))
              seq.items.push({ start: [this.sourceToken] });
            else
              it.start.push(this.sourceToken);
            return;
        }
        if (this.indent > seq.indent) {
          const bv = this.startBlockValue(seq);
          if (bv) {
            this.stack.push(bv);
            return;
          }
        }
        yield* this.pop();
        yield* this.step();
      }
      *flowCollection(fc) {
        const it = fc.items[fc.items.length - 1];
        if (this.type === "flow-error-end") {
          let top;
          do {
            yield* this.pop();
            top = this.peek(1);
          } while (top?.type === "flow-collection");
        } else if (fc.end.length === 0) {
          switch (this.type) {
            case "comma":
            case "explicit-key-ind":
              if (!it || it.sep)
                fc.items.push({ start: [this.sourceToken] });
              else
                it.start.push(this.sourceToken);
              return;
            case "map-value-ind":
              if (!it || it.value)
                fc.items.push({ start: [], key: null, sep: [this.sourceToken] });
              else if (it.sep)
                it.sep.push(this.sourceToken);
              else
                Object.assign(it, { key: null, sep: [this.sourceToken] });
              return;
            case "space":
            case "comment":
            case "newline":
            case "anchor":
            case "tag":
              if (!it || it.value)
                fc.items.push({ start: [this.sourceToken] });
              else if (it.sep)
                it.sep.push(this.sourceToken);
              else
                it.start.push(this.sourceToken);
              return;
            case "alias":
            case "scalar":
            case "single-quoted-scalar":
            case "double-quoted-scalar": {
              const fs = this.flowScalar(this.type);
              if (!it || it.value)
                fc.items.push({ start: [], key: fs, sep: [] });
              else if (it.sep)
                this.stack.push(fs);
              else
                Object.assign(it, { key: fs, sep: [] });
              return;
            }
            case "flow-map-end":
            case "flow-seq-end":
              fc.end.push(this.sourceToken);
              return;
          }
          const bv = this.startBlockValue(fc);
          if (bv)
            this.stack.push(bv);
          else {
            yield* this.pop();
            yield* this.step();
          }
        } else {
          const parent = this.peek(2);
          if (parent.type === "block-map" && (this.type === "map-value-ind" && parent.indent === fc.indent || this.type === "newline" && !parent.items[parent.items.length - 1].sep)) {
            yield* this.pop();
            yield* this.step();
          } else if (this.type === "map-value-ind" && parent.type !== "flow-collection") {
            const prev = getPrevProps(parent);
            const start = getFirstKeyStartProps(prev);
            fixFlowSeqItems(fc);
            const sep = fc.end.splice(1, fc.end.length);
            sep.push(this.sourceToken);
            const map = {
              type: "block-map",
              offset: fc.offset,
              indent: fc.indent,
              items: [{ start, key: fc, sep }]
            };
            this.onKeyLine = true;
            this.stack[this.stack.length - 1] = map;
          } else {
            yield* this.lineEnd(fc);
          }
        }
      }
      flowScalar(type) {
        if (this.onNewLine) {
          let nl = this.source.indexOf("\n") + 1;
          while (nl !== 0) {
            this.onNewLine(this.offset + nl);
            nl = this.source.indexOf("\n", nl) + 1;
          }
        }
        return {
          type,
          offset: this.offset,
          indent: this.indent,
          source: this.source
        };
      }
      startBlockValue(parent) {
        switch (this.type) {
          case "alias":
          case "scalar":
          case "single-quoted-scalar":
          case "double-quoted-scalar":
            return this.flowScalar(this.type);
          case "block-scalar-header":
            return {
              type: "block-scalar",
              offset: this.offset,
              indent: this.indent,
              props: [this.sourceToken],
              source: ""
            };
          case "flow-map-start":
          case "flow-seq-start":
            return {
              type: "flow-collection",
              offset: this.offset,
              indent: this.indent,
              start: this.sourceToken,
              items: [],
              end: []
            };
          case "seq-item-ind":
            return {
              type: "block-seq",
              offset: this.offset,
              indent: this.indent,
              items: [{ start: [this.sourceToken] }]
            };
          case "explicit-key-ind": {
            this.onKeyLine = true;
            const prev = getPrevProps(parent);
            const start = getFirstKeyStartProps(prev);
            start.push(this.sourceToken);
            return {
              type: "block-map",
              offset: this.offset,
              indent: this.indent,
              items: [{ start, explicitKey: true }]
            };
          }
          case "map-value-ind": {
            this.onKeyLine = true;
            const prev = getPrevProps(parent);
            const start = getFirstKeyStartProps(prev);
            return {
              type: "block-map",
              offset: this.offset,
              indent: this.indent,
              items: [{ start, key: null, sep: [this.sourceToken] }]
            };
          }
        }
        return null;
      }
      atIndentedComment(start, indent) {
        if (this.type !== "comment")
          return false;
        if (this.indent <= indent)
          return false;
        return start.every((st) => st.type === "newline" || st.type === "space");
      }
      *documentEnd(docEnd) {
        if (this.type !== "doc-mode") {
          if (docEnd.end)
            docEnd.end.push(this.sourceToken);
          else
            docEnd.end = [this.sourceToken];
          if (this.type === "newline")
            yield* this.pop();
        }
      }
      *lineEnd(token) {
        switch (this.type) {
          case "comma":
          case "doc-start":
          case "doc-end":
          case "flow-seq-end":
          case "flow-map-end":
          case "map-value-ind":
            yield* this.pop();
            yield* this.step();
            break;
          case "newline":
            this.onKeyLine = false;
          // fallthrough
          case "space":
          case "comment":
          default:
            if (token.end)
              token.end.push(this.sourceToken);
            else
              token.end = [this.sourceToken];
            if (this.type === "newline")
              yield* this.pop();
        }
      }
    };
    exports2.Parser = Parser;
  }
});

// ../node_modules/yaml/dist/public-api.js
var require_public_api = __commonJS({
  "../node_modules/yaml/dist/public-api.js"(exports2) {
    "use strict";
    var composer = require_composer();
    var Document = require_Document();
    var errors = require_errors();
    var log2 = require_log();
    var identity = require_identity();
    var lineCounter = require_line_counter();
    var parser = require_parser();
    function parseOptions(options) {
      const prettyErrors = options.prettyErrors !== false;
      const lineCounter$1 = options.lineCounter || prettyErrors && new lineCounter.LineCounter() || null;
      return { lineCounter: lineCounter$1, prettyErrors };
    }
    function parseAllDocuments(source, options = {}) {
      const { lineCounter: lineCounter2, prettyErrors } = parseOptions(options);
      const parser$1 = new parser.Parser(lineCounter2?.addNewLine);
      const composer$1 = new composer.Composer(options);
      const docs = Array.from(composer$1.compose(parser$1.parse(source)));
      if (prettyErrors && lineCounter2)
        for (const doc of docs) {
          doc.errors.forEach(errors.prettifyError(source, lineCounter2));
          doc.warnings.forEach(errors.prettifyError(source, lineCounter2));
        }
      if (docs.length > 0)
        return docs;
      return Object.assign([], { empty: true }, composer$1.streamInfo());
    }
    function parseDocument(source, options = {}) {
      const { lineCounter: lineCounter2, prettyErrors } = parseOptions(options);
      const parser$1 = new parser.Parser(lineCounter2?.addNewLine);
      const composer$1 = new composer.Composer(options);
      let doc = null;
      for (const _doc of composer$1.compose(parser$1.parse(source), true, source.length)) {
        if (!doc)
          doc = _doc;
        else if (doc.options.logLevel !== "silent") {
          doc.errors.push(new errors.YAMLParseError(_doc.range.slice(0, 2), "MULTIPLE_DOCS", "Source contains multiple documents; please use YAML.parseAllDocuments()"));
          break;
        }
      }
      if (prettyErrors && lineCounter2) {
        doc.errors.forEach(errors.prettifyError(source, lineCounter2));
        doc.warnings.forEach(errors.prettifyError(source, lineCounter2));
      }
      return doc;
    }
    function parse(src, reviver, options) {
      let _reviver = void 0;
      if (typeof reviver === "function") {
        _reviver = reviver;
      } else if (options === void 0 && reviver && typeof reviver === "object") {
        options = reviver;
      }
      const doc = parseDocument(src, options);
      if (!doc)
        return null;
      doc.warnings.forEach((warning) => log2.warn(doc.options.logLevel, warning));
      if (doc.errors.length > 0) {
        if (doc.options.logLevel !== "silent")
          throw doc.errors[0];
        else
          doc.errors = [];
      }
      return doc.toJS(Object.assign({ reviver: _reviver }, options));
    }
    function stringify(value, replacer, options) {
      let _replacer = null;
      if (typeof replacer === "function" || Array.isArray(replacer)) {
        _replacer = replacer;
      } else if (options === void 0 && replacer) {
        options = replacer;
      }
      if (typeof options === "string")
        options = options.length;
      if (typeof options === "number") {
        const indent = Math.round(options);
        options = indent < 1 ? void 0 : indent > 8 ? { indent: 8 } : { indent };
      }
      if (value === void 0) {
        const { keepUndefined } = options ?? replacer ?? {};
        if (!keepUndefined)
          return void 0;
      }
      if (identity.isDocument(value) && !_replacer)
        return value.toString(options);
      return new Document.Document(value, _replacer, options).toString(options);
    }
    exports2.parse = parse;
    exports2.parseAllDocuments = parseAllDocuments;
    exports2.parseDocument = parseDocument;
    exports2.stringify = stringify;
  }
});

// ../node_modules/yaml/dist/index.js
var require_dist = __commonJS({
  "../node_modules/yaml/dist/index.js"(exports2) {
    "use strict";
    var composer = require_composer();
    var Document = require_Document();
    var Schema = require_Schema();
    var errors = require_errors();
    var Alias = require_Alias();
    var identity = require_identity();
    var Pair = require_Pair();
    var Scalar = require_Scalar();
    var YAMLMap = require_YAMLMap();
    var YAMLSeq = require_YAMLSeq();
    var cst = require_cst();
    var lexer = require_lexer();
    var lineCounter = require_line_counter();
    var parser = require_parser();
    var publicApi = require_public_api();
    var visit = require_visit();
    exports2.Composer = composer.Composer;
    exports2.Document = Document.Document;
    exports2.Schema = Schema.Schema;
    exports2.YAMLError = errors.YAMLError;
    exports2.YAMLParseError = errors.YAMLParseError;
    exports2.YAMLWarning = errors.YAMLWarning;
    exports2.Alias = Alias.Alias;
    exports2.isAlias = identity.isAlias;
    exports2.isCollection = identity.isCollection;
    exports2.isDocument = identity.isDocument;
    exports2.isMap = identity.isMap;
    exports2.isNode = identity.isNode;
    exports2.isPair = identity.isPair;
    exports2.isScalar = identity.isScalar;
    exports2.isSeq = identity.isSeq;
    exports2.Pair = Pair.Pair;
    exports2.Scalar = Scalar.Scalar;
    exports2.YAMLMap = YAMLMap.YAMLMap;
    exports2.YAMLSeq = YAMLSeq.YAMLSeq;
    exports2.CST = cst;
    exports2.Lexer = lexer.Lexer;
    exports2.LineCounter = lineCounter.LineCounter;
    exports2.Parser = parser.Parser;
    exports2.parse = publicApi.parse;
    exports2.parseAllDocuments = publicApi.parseAllDocuments;
    exports2.parseDocument = publicApi.parseDocument;
    exports2.stringify = publicApi.stringify;
    exports2.visit = visit.visit;
    exports2.visitAsync = visit.visitAsync;
  }
});

// src/action.ts
var action_exports = {};
__export(action_exports, {
  input: () => input,
  prNumberFromEvent: () => prNumberFromEvent,
  run: () => run
});
module.exports = __toCommonJS(action_exports);
var import_node_fs4 = require("node:fs");

// ../packages/shared/src/actions-io.ts
var import_node_crypto = require("node:crypto");
var import_node_fs = require("node:fs");
function getInput(name, fallback = "", env = process.env) {
  const v = env[`INPUT_${name.replace(/ /g, "_").toUpperCase()}`];
  return v === void 0 || v.trim() === "" ? fallback : v.trim();
}
function setOutput(name, value, env = process.env) {
  const file = env.GITHUB_OUTPUT;
  if (!file) return;
  const delim = `ghadelim_${(0, import_node_crypto.randomUUID)()}`;
  (0, import_node_fs.appendFileSync)(file, `${name}<<${delim}
${value}
${delim}
`);
}
function appendSummary(markdown, env = process.env) {
  const file = env.GITHUB_STEP_SUMMARY;
  if (file) (0, import_node_fs.appendFileSync)(file, `${markdown}
`);
}
function escapeData(s) {
  return s.replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A");
}

// ../packages/shared/src/plan.ts
var import_node_crypto2 = require("node:crypto");
var import_node_fs2 = require("node:fs");
var import_node_path = require("node:path");

// ../brand.json
var brand_default = {
  _comment: "Single source of every brand string in the Mainfast suite. Edit here, then run `npm run brand:sync` at the suite root: it rewrites each package's action.yml, package.json, plugin.json and example workflows. TypeScript reads this file directly through @mainfast/shared/brand. Prose (README.md, docs/, SKILL.md) is not rewritten: grep for the old value after a rename. `npm run brand:check` (and test/brand.test.ts) fails when a generated file drifts.",
  suite: {
    name: "Mainfast",
    version: "0.1.0",
    author: "Mainfast authors",
    copyrightYear: "2026",
    license: "MIT",
    githubOrg: "mainfast",
    githubRepo: "mainfast",
    homepageUrl: "https://github.com/mainfast/mainfast",
    docsUrl: "https://github.com/mainfast/mainfast#readme",
    issuesUrl: "https://github.com/mainfast/mainfast/issues",
    pricingUrl: "https://github.com/mainfast/mainfast#free-and-pro",
    npmScope: "@mainfast",
    configFile: ".mainfast.yml",
    configFileAlt: ".mainfast.yaml",
    schemaUrl: "https://raw.githubusercontent.com/mainfast/mainfast/main/schema/mainfast.schema.json",
    envPrefix: "MAINFAST",
    licenseEnv: "MAINFAST_LICENSE",
    plan: {
      freeActiveContributors: 5,
      windowDays: 30,
      proPricePerContributorMonth: "$4",
      _benefitIds: "Polar licence-key benefit id of each plan (sandbox until launch): a key whose benefit_id is `pro` is Mainfast Pro; `free` is the optional free key (registered user, not Pro). tools/dev-sites/polar.mjs --apply prints the sandbox ids.",
      benefitIds: {
        free: "77fcbd42-f163-444e-9931-c98610f8063f",
        pro: "9f2bb2ac-6b53-4c17-9cae-a2e2eccfad32"
      }
    },
    polar: {
      _comment: "Licence keys are checked with Polar's public customer-portal endpoint POST {api}/v1/customer-portal/license-keys/validate {key, organization_id}: no merchant secret. Until launch `api`, organizationId and the benefit ids are the Polar SANDBOX ones (29 Oct 2026); at launch put production Polar and its ids here. While organizationId is all zeros no key is sent anywhere. apiEnv / orgEnv override both, e.g. the sandbox.",
      api: "https://sandbox-api.polar.sh",
      sandboxApi: "https://sandbox-api.polar.sh",
      organizationId: "f450cee3-327c-452e-a949-2557a22a7692",
      apiEnv: "MAINFAST_POLAR_API",
      orgEnv: "MAINFAST_POLAR_ORG",
      timeoutMs: 3e3
    }
  },
  products: {
    intact: {
      productName: "Mainfast Intact",
      tagline: "prove merge commits did not silently drop changes from main",
      description: "Prove merge commits did not silently drop changes from main (dropped hunks, evil merges).",
      npmName: "@mainfast/intact",
      cliName: "mainfast",
      configSection: "intact",
      checkName: "Mainfast Intact",
      commentMarker: "<!-- mainfast-intact:sticky -->",
      actionRef: "mainfast/intact@v0",
      branding: { icon: "git-merge", color: "blue" },
      plugin: {
        name: "mainfast",
        description: "Mainfast Intact: check merge commits for dropped main changes before you push."
      }
    },
    migrations: {
      productName: "Mainfast Migrations",
      tagline: "database migration guard",
      description: "Fails a PR whose database migrations would fork the migration history once merged into main (Alembic, Django, Prisma, Rails, Flyway, Drizzle), and re-checks open PRs with a blocking commit status when main moves.",
      npmName: "@mainfast/migrations",
      cliName: "mainfast-migrations",
      configSection: "migrations",
      checkName: "Mainfast Migrations",
      commentMarker: "<!-- mainfast-migrations:sticky -->",
      statusContext: "mainfast/migrations",
      staleLabel: "mainfast: migrations stale",
      actionRef: "mainfast/migrations@v0",
      branding: { icon: "database", color: "blue" }
    },
    rollcall: {
      productName: "Mainfast Rollcall",
      tagline: "required-check integrity audit",
      description: "Audits required status checks (branch protection and rulesets) against what recent merged and open PRs actually reported \u2014 never-ran, skipped-as-success, renamed, path-filtered, merged while pending, drift \u2014 and keeps one tracking issue open while something is wrong.",
      npmName: "@mainfast/rollcall",
      cliName: "mainfast-rollcall",
      configSection: "rollcall",
      checkName: "Mainfast Rollcall",
      commentMarker: "<!-- mainfast-rollcall:sticky -->",
      actionRef: "mainfast/rollcall@v0",
      branding: { icon: "check-square", color: "blue" }
    },
    owners: {
      productName: "Mainfast Owners",
      tagline: "CODEOWNERS drift check",
      description: "CODEOWNERS drift \u2014 unowned files a PR touches, owners who left the org or lost write access, missing teams, dead patterns, dormant owners.",
      npmName: "@mainfast/owners",
      cliName: "mainfast-owners",
      configSection: "owners",
      checkName: "Mainfast Owners",
      commentMarker: "<!-- mainfast-owners:sticky -->",
      actionRef: "mainfast/owners@v0",
      branding: { icon: "users", color: "blue" }
    },
    evidence: {
      productName: "Mainfast Evidence",
      tagline: "proof, not review, for pull requests written by coding agents",
      description: "Proof, not review, for pull requests written by coding agents. Posts an evidence card per head commit.",
      npmName: "@mainfast/evidence",
      cliName: "mainfast-evidence",
      configSection: "evidence",
      checkName: "Mainfast Evidence",
      commentMarker: "<!-- mainfast-evidence:sticky -->",
      actionRef: "mainfast/evidence@v0",
      branding: { icon: "check-square", color: "green" }
    }
  }
};

// ../packages/shared/src/brand.ts
var PRODUCT_SLUGS = ["intact", "migrations", "rollcall", "owners", "evidence"];
var SUITE = brand_default.suite;
function product(slug) {
  const raw = brand_default.products[slug];
  if (!raw) throw new Error(`brand.json has no product "${slug}"`);
  return {
    ...raw,
    slug,
    configSection: raw.configSection,
    docsUrl: `${SUITE.homepageUrl}/tree/main/${slug}#readme`
  };
}
var PRODUCTS = PRODUCT_SLUGS.map(product);

// ../packages/shared/src/github.ts
var DEFAULT_API_URL = "https://api.github.com";
var GITHUB_API_VERSION = "2022-11-28";
var GitHubError = class extends Error {
  method;
  path;
  status;
  body;
  constructor(method, path, status, body) {
    super(`GitHub ${method} ${path} -> ${status}: ${errorText(body)}`);
    this.method = method;
    this.path = path;
    this.status = status;
    this.body = body;
  }
};
function errorText(body) {
  try {
    const m = JSON.parse(body).message;
    if (typeof m === "string" && m) return m;
  } catch {
  }
  return body.slice(0, 300);
}
var enc = encodeURIComponent;
var encPath = (p) => p.split("/").map(enc).join("/");
var GitHub = class {
  apiUrl;
  opts;
  fetchImpl;
  maxPages;
  constructor(opts) {
    this.opts = opts;
    this.apiUrl = (opts.apiUrl || DEFAULT_API_URL).replace(/\/+$/, "");
    this.fetchImpl = opts.fetch ?? ((url, init) => fetch(url, init));
    this.maxPages = opts.maxPages ?? 10;
  }
  /** True when requests carry a token. */
  get hasToken() {
    return Boolean(this.opts.token);
  }
  async request(method, path, body, extraHeaders = {}) {
    const url = path.startsWith("http") ? path : `${this.apiUrl}${path}`;
    const headers = {
      accept: "application/vnd.github+json",
      "x-github-api-version": GITHUB_API_VERSION,
      "user-agent": this.opts.userAgent
    };
    if (this.opts.token) headers.authorization = `Bearer ${this.opts.token}`;
    if (body !== void 0) headers["content-type"] = "application/json";
    Object.assign(headers, extraHeaders);
    const res = await this.fetchImpl(url, {
      method,
      headers,
      body: body === void 0 ? void 0 : JSON.stringify(body)
    });
    const text = await res.text();
    const shortPath = url.startsWith(this.apiUrl) ? url.slice(this.apiUrl.length) : path;
    if (!res.ok) throw new GitHubError(method, shortPath, res.status, text);
    const data = text ? JSON.parse(text) : void 0;
    return { status: res.status, data, headers: res.headers };
  }
  async get(path) {
    return (await this.request("GET", path)).data;
  }
  /** GET that maps 404 to undefined instead of throwing. */
  async getOptional(path) {
    try {
      return await this.get(path);
    } catch (e) {
      if (e instanceof GitHubError && e.status === 404) return void 0;
      throw e;
    }
  }
  /** True on 2xx (including 204), false on 404; anything else throws. */
  async exists(path) {
    try {
      await this.request("GET", path);
      return true;
    } catch (e) {
      if (e instanceof GitHubError && e.status === 404) return false;
      throw e;
    }
  }
  /**
   * Follows `Link: rel="next"` headers. `key` picks the array out of wrapped
   * responses such as `{ total_count, check_runs: [...] }`.
   */
  async paginate(path, key) {
    const out = [];
    let next = path;
    for (let page = 0; next && page < this.maxPages; page++) {
      const res = await this.request("GET", next);
      const items = key ? res.data[key] : res.data;
      if (Array.isArray(items)) out.push(...items);
      next = parseNextLink(res.headers.get("link"));
    }
    return out;
  }
  /**
   * A text file from the contents API at `ref` (default branch when omitted), or undefined
   * when the file, the ref or the repository does not exist (404).
   */
  async getFileText(owner, repo, path, ref) {
    const q = ref ? `?ref=${enc(ref)}` : "";
    const d = await this.getOptional(
      `/repos/${enc(owner)}/${enc(repo)}/contents/${encPath(path)}${q}`
    );
    if (!d || d.type !== "file" || typeof d.content !== "string") return void 0;
    return d.encoding === "base64" ? Buffer.from(d.content, "base64").toString("utf8") : d.content;
  }
};
function parseNextLink(link) {
  if (!link) return void 0;
  for (const part of link.split(",")) {
    const m = part.match(/<([^>]+)>\s*;\s*rel="next"/);
    if (m) return m[1];
  }
  return void 0;
}
var DEFAULT_COMMENT_AUTHOR = "github-actions[bot]";
function findSticky(comments, marker, author) {
  const me = author.toLowerCase();
  return comments.find((c) => c.user?.login?.toLowerCase() === me && typeof c.body === "string" && c.body.startsWith(marker));
}

// ../packages/shared/src/plan.ts
var PLACEHOLDER_ORG = /^0{8}-0{4}-0{4}-0{4}-0{12}$/;
function planForBenefit(benefitId, ids = SUITE.plan.benefitIds) {
  if (typeof benefitId !== "string" || !benefitId) return void 0;
  if (benefitId === ids.pro) return "pro";
  if (benefitId === ids.free) return "free";
  return void 0;
}
function polarValidator(opts = {}) {
  const env = opts.env ?? process.env;
  const api = (opts.api ?? (env[SUITE.polar.apiEnv] || SUITE.polar.api)).replace(/\/+$/, "");
  const org = opts.organizationId ?? (env[SUITE.polar.orgEnv] || SUITE.polar.organizationId);
  const ids = opts.benefitIds ?? SUITE.plan.benefitIds;
  const timeoutMs = opts.timeoutMs ?? SUITE.polar.timeoutMs;
  const doFetch = opts.fetch ?? ((url, init) => fetch(url, init));
  const offline = { valid: true, offline: true };
  return async (rawKey) => {
    const key = rawKey.trim();
    if (!key) return { valid: false, offline: true, reason: "empty key" };
    if (PLACEHOLDER_ORG.test(org)) return offline;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    let status;
    let text;
    try {
      const res = await doFetch(`${api}/v1/customer-portal/license-keys/validate`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json", "User-Agent": `${SUITE.name.toLowerCase()}-licence` },
        body: JSON.stringify({ key, organization_id: org }),
        signal: ctrl.signal
      });
      status = res.status;
      text = status === 200 ? await res.text() : "";
    } catch {
      return offline;
    } finally {
      clearTimeout(timer);
    }
    if (status === 404) return { valid: false, offline: false, reason: "Polar does not know this key, or reports it revoked, disabled or expired" };
    if (status !== 200) return offline;
    let lk;
    try {
      const parsed = JSON.parse(text);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return offline;
      lk = parsed;
    } catch {
      return offline;
    }
    if (lk.status !== void 0 && lk.status !== null && lk.status !== "granted") {
      return { valid: false, offline: false, reason: `Polar reports the key as ${JSON.stringify(String(lk.status))}` };
    }
    if (lk.organization_id && lk.organization_id !== org) {
      return { valid: false, offline: false, reason: `the key belongs to another Polar organisation, not ${SUITE.name}` };
    }
    const plan = planForBenefit(lk.benefit_id, ids);
    if (!plan) return { valid: false, offline: false, reason: `the key is not a ${SUITE.name} key (unknown benefit)` };
    if (typeof lk.expires_at === "string" && lk.expires_at) {
      const exp = new Date(lk.expires_at);
      if (!Number.isNaN(exp.getTime()) && exp.getTime() <= (opts.now?.() ?? /* @__PURE__ */ new Date()).getTime()) {
        return { valid: false, offline: false, reason: `the key expired on ${exp.toISOString().slice(0, 10)}` };
      }
    }
    return { valid: true, offline: false, plan };
  };
}
var BOT_LOGINS = /* @__PURE__ */ new Set(["dependabot", "renovate", "github-actions", "copilot", "web-flow", "ghost"]);
function isBot(user) {
  if (!user?.login) return true;
  const login = user.login.toLowerCase();
  return user.type === "Bot" || login.endsWith("[bot]") || login.endsWith("-bot") || BOT_LOGINS.has(login);
}
var memo = /* @__PURE__ */ new Map();
var keyMemo = /* @__PURE__ */ new Map();
function keyHash(key) {
  return (0, import_node_crypto2.createHash)("sha256").update(key.trim()).digest("hex").slice(0, 24);
}
function cacheFile(dir, owner, repo) {
  return (0, import_node_path.join)(dir, `mainfast-plan-${owner}-${repo}.json`.replace(/[^\w.-]/g, "_"));
}
async function countActiveContributors(gh, owner, repo, since, stopAbove = Infinity) {
  const people = /* @__PURE__ */ new Set();
  const add = (u) => {
    if (!isBot(u)) people.add(u.login.toLowerCase());
  };
  const done = () => people.size > stopAbove;
  const sinceIso = since.toISOString();
  const r = `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
  let anySource = false;
  let lastError;
  try {
    let next = `${r}/pulls?state=all&sort=created&direction=desc&per_page=100`;
    for (let page = 0; next && page < 5 && !done(); page++) {
      const res = await gh.request("GET", next);
      let older = false;
      for (const p of res.data) {
        if (p.created_at < sinceIso) {
          older = true;
          break;
        }
        add(p.user);
      }
      next = older ? void 0 : parseNextLink(res.headers.get("link"));
    }
    anySource = true;
  } catch (e) {
    lastError = e;
  }
  if (!done()) {
    try {
      let next = `${r}/activity?time_period=month&activity_type=push&per_page=100`;
      for (let page = 0; next && page < 5 && !done(); page++) {
        const res = await gh.request("GET", next);
        for (const a of res.data) if (a.timestamp >= sinceIso) add(a.actor);
        next = parseNextLink(res.headers.get("link"));
      }
      anySource = true;
    } catch (e) {
      lastError = e;
      try {
        let next = `${r}/commits?since=${encodeURIComponent(sinceIso)}&per_page=100`;
        for (let page = 0; next && page < 5 && !done(); page++) {
          const res = await gh.request("GET", next);
          for (const c of res.data) add(c.author);
          next = parseNextLink(res.headers.get("link"));
        }
        anySource = true;
      } catch (e2) {
        lastError = e2;
      }
    }
  }
  if (!anySource) throw lastError instanceof Error ? lastError : new Error("no contributor source available");
  return people.size;
}
function planNotice(productName, active, freeKey = false) {
  const p = SUITE.plan;
  return [
    `> [!NOTE]`,
    `> **${SUITE.name} is free for public repositories and for private repositories with up to ${p.freeActiveContributors} active contributors.**`,
    `> This private repository had ${active} active contributors in the last ${p.windowDays} days (people who opened a pull request or pushed; bots excluded).`,
    `> ${SUITE.name} Pro is ${p.proPricePerContributorMonth} per active contributor per month: ${SUITE.pricingUrl}.`,
    ...freeKey ? [`> The key passed to this step is the free ${SUITE.name} key (registered, thank you); it does not cover Pro.`] : [],
    `> With a key, save it as the \`${SUITE.licenseEnv}\` secret and pass \`license: \${{ secrets.${SUITE.licenseEnv} }}\` to the action.`,
    `> ${productName} ran in full and this notice never changes its result.`
  ].join("\n");
}
async function checkPlan(opts) {
  const { gh, owner, repo } = opts;
  let isPrivate = opts.event?.repository?.private;
  if (typeof isPrivate !== "boolean") {
    try {
      isPrivate = (await gh.get(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`)).private;
    } catch (e) {
      return { status: "unknown", reason: describe(e) };
    }
  }
  const licence = opts.license?.trim() ?? "";
  if (isPrivate !== true) return withKey({ status: "public" }, licence ? await checkKey(opts, licence) : void 0);
  const limit = SUITE.plan.freeActiveContributors;
  const key = `${owner}/${repo}`.toLowerCase();
  let active = memo.get(key);
  const file = opts.cacheDir ? cacheFile(opts.cacheDir, owner, repo) : void 0;
  if (active === void 0 && file && (0, import_node_fs2.existsSync)(file)) {
    try {
      const c = JSON.parse((0, import_node_fs2.readFileSync)(file, "utf8"));
      if (c.runId === (opts.runId ?? "") && typeof c.active === "number") active = c.active;
    } catch {
    }
  }
  if (active === void 0) {
    const since = new Date((opts.now ?? /* @__PURE__ */ new Date()).getTime() - SUITE.plan.windowDays * 864e5);
    try {
      active = await countActiveContributors(gh, owner, repo, since, limit);
    } catch (e) {
      return { status: "unknown", reason: describe(e) };
    }
    memo.set(key, active);
    if (file) {
      try {
        (0, import_node_fs2.mkdirSync)(opts.cacheDir, { recursive: true });
        (0, import_node_fs2.writeFileSync)(file, JSON.stringify({ runId: opts.runId ?? "", active }));
      } catch {
      }
    }
  }
  const check = licence ? await checkKey(opts, licence, active) : void 0;
  const state = keyState(check);
  if (state === "pro" || state === "unverified" && active > limit) return withKey({ status: "licensed", activeContributors: active }, check);
  if (active <= limit) return withKey({ status: "free", activeContributors: active }, check);
  return withKey({ status: "over-limit", activeContributors: active, notice: planNotice(opts.productName, active, state === "free") }, check);
}
function keyState(check) {
  if (!check) return void 0;
  if (!check.valid) return "refused";
  if (check.offline || !check.plan) return "unverified";
  return check.plan;
}
function withKey(result, check) {
  const state = keyState(check);
  if (!state) return result;
  return state === "refused" ? { ...result, key: state, keyReason: check?.reason ?? "refused" } : { ...result, key: state };
}
async function checkKey(opts, licence, activeContributors) {
  const h = keyHash(licence);
  const hit = keyMemo.get(h);
  if (hit) return hit;
  const file = opts.cacheDir ? (0, import_node_path.join)(opts.cacheDir, `mainfast-licence-${h}.json`) : void 0;
  if (file && (0, import_node_fs2.existsSync)(file)) {
    try {
      const c = JSON.parse((0, import_node_fs2.readFileSync)(file, "utf8"));
      if (c.runId === (opts.runId ?? "") && c.check && typeof c.check.valid === "boolean") {
        keyMemo.set(h, c.check);
        return c.check;
      }
    } catch {
    }
  }
  const check = await (opts.validate ?? polarValidator())(licence, { owner: opts.owner, repo: opts.repo, activeContributors }).catch(
    () => ({ valid: true, offline: true })
  );
  keyMemo.set(h, check);
  if (file) {
    try {
      (0, import_node_fs2.mkdirSync)(opts.cacheDir, { recursive: true });
      (0, import_node_fs2.writeFileSync)(file, JSON.stringify({ runId: opts.runId ?? "", check }));
    } catch {
    }
  }
  return check;
}
function describe(e) {
  return e instanceof GitHubError ? `GitHub ${e.status} on ${e.path}` : e instanceof Error ? e.message : String(e);
}
async function planGate(opts) {
  const env = opts.env ?? process.env;
  if (!opts.gh.hasToken) return { status: "unknown", reason: "no token" };
  try {
    const result = await checkPlan({
      ...opts,
      license: opts.license ?? (getInput("license", "", env) || env[SUITE.licenseEnv] || ""),
      cacheDir: env.RUNNER_TEMP,
      runId: env.GITHUB_RUN_ID
    });
    if (result.key === "refused") {
      process.stdout.write(`${SUITE.name}: the licence key was not accepted (${result.keyReason}); running as without a key. The check result is unaffected.
`);
    } else if (result.key === "free" && !result.notice) {
      appendSummary(`
<sub>${SUITE.name}: Registered (free key).</sub>
`, env);
    }
    if (result.notice) {
      appendSummary(`
${result.notice}
`, env);
      process.stdout.write(
        `${SUITE.name}: free for up to ${SUITE.plan.freeActiveContributors} active contributors on private repositories; this one has ${result.activeContributors}. Pro: ${SUITE.plan.proPricePerContributorMonth}/contributor/month (${SUITE.pricingUrl}). The check result is unaffected.
`
      );
    }
    return result;
  } catch (e) {
    return { status: "unknown", reason: describe(e) };
  }
}

// src/action.ts
var import_node_path3 = require("node:path");

// package.json
var package_default = {
  name: "@mainfast/evidence",
  version: "0.1.0",
  private: true,
  description: "Mainfast Evidence: proof, not review, for pull requests written by coding agents.",
  license: "MIT",
  author: "Mainfast authors",
  type: "module",
  engines: {
    node: ">=20"
  },
  bin: {
    "mainfast-evidence": "dist/cli.cjs"
  },
  main: "dist/lib.cjs",
  files: [
    "dist",
    "action.yml",
    "README.md",
    "LICENSE"
  ],
  scripts: {
    typecheck: "tsc --noEmit -p .",
    test: "vitest run",
    build: "node build.mjs",
    all: "npm run typecheck && npm test && npm run build"
  },
  dependencies: {
    "@mainfast/shared": "0.1.0",
    yaml: "^2.9.1"
  },
  homepage: "https://github.com/mainfast/mainfast/tree/main/evidence#readme",
  bugs: {
    url: "https://github.com/mainfast/mainfast/issues"
  },
  repository: {
    type: "git",
    url: "git+https://github.com/mainfast/mainfast.git",
    directory: "evidence"
  }
};

// src/constants.ts
var P = product("evidence");
var SUITE_NAME = SUITE.name;
var PRODUCT_NAME = P.productName;
var PRODUCT_SLUG = P.slug;
var CLI_NAME = P.cliName;
var VERSION = package_default.version;
var CONFIG_FILE = SUITE.configFile;
var CONFIG_SECTION = P.configSection;
var CHECK_NAME = P.checkName;
var COMMENT_MARKER = P.commentMarker;
var GITHUB_ORG = SUITE.githubOrg;
var GITHUB_REPO = SUITE.githubRepo;
var HOMEPAGE_URL = SUITE.homepageUrl;
var DOCS_URL = P.docsUrl;
var ACTION_REF = P.actionRef;
var ENV_PREFIX = `${SUITE.envPrefix}_${P.slug.toUpperCase()}`;
var USER_AGENT = `${P.cliName}/${VERSION}`;

// ../packages/shared/src/config.ts
var import_yaml = __toESM(require_dist(), 1);
var TOP_LEVEL_KEYS = ["version", "extends", ...PRODUCT_SLUGS];
var MainfastConfigError = class extends Error {
};
function isMapping(v) {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
function topLevelProblems(doc, source = SUITE.configFile) {
  if (doc === null || doc === void 0) return [];
  if (!isMapping(doc)) return [`${source}: top level must be a mapping`];
  const out = [];
  for (const k of Object.keys(doc)) {
    if (!TOP_LEVEL_KEYS.includes(k)) out.push(`${source}: unknown top-level key "${k}" (known: ${TOP_LEVEL_KEYS.join(", ")})`);
  }
  if (doc.version !== void 0 && doc.version !== 1) out.push(`${source}: unsupported version ${String(doc.version)} (only 1)`);
  if (doc.extends !== void 0) {
    try {
      if (typeof doc.extends !== "string") throw new MainfastConfigError("extends must be a string");
      parseExtends(doc.extends);
    } catch (e) {
      out.push(`${source}: ${e.message}`);
    }
  }
  return out;
}
function parseExtends(raw) {
  const s = raw.trim();
  if (s.startsWith("./") || s.startsWith("/")) {
    const path2 = s.replace(/^\.?\//, "");
    if (!path2 || path2.includes("..")) throw new MainfastConfigError(`extends: bad local path "${raw}"`);
    return { kind: "local", path: path2, raw: s };
  }
  const m = /^([A-Za-z0-9-]+)\/([A-Za-z0-9._-]+)(?::([^@]+))?(?:@(.+))?$/.exec(s);
  if (!m) throw new MainfastConfigError(`extends: expected owner/repo[:path][@ref] or ./path, got "${raw}"`);
  const path = (m[3] ?? SUITE.configFile).replace(/^\/+/, "");
  if (path.includes("..")) throw new MainfastConfigError(`extends: bad path "${raw}"`);
  return { kind: "repo", owner: m[1], repo: m[2], path, ref: m[4], raw: s };
}

// src/config.ts
var import_yaml2 = __toESM(require_dist(), 1);

// src/types.ts
var FLAG_IDS = [
  "tests_not_run_on_head",
  "tests_failed",
  "tests_skipped",
  "tests_empty",
  "required_check_missing",
  "required_check_skipped",
  "required_check_failed",
  "coverage_below_threshold",
  "coverage_missing",
  "touched_workflows",
  "touched_codeowners",
  "touched_lockfiles",
  "touched_tests",
  "touched_test_config",
  "touched_policy",
  "tests_deleted",
  "tests_removed",
  "assertions_dropped",
  "assertions_commented_out",
  "skip_added",
  "focus_added",
  "trivial_assertion_added",
  "claim_tests_added_unbacked",
  "claim_tests_pass_unbacked",
  "diff_too_large",
  "secret_like_string",
  "diff_unanalyzed"
];

// src/config.ts
var DEFAULT_FLAGS = {
  tests_not_run_on_head: "fail",
  tests_failed: "fail",
  tests_skipped: "warn",
  tests_empty: "fail",
  required_check_missing: "fail",
  required_check_skipped: "fail",
  required_check_failed: "warn",
  coverage_below_threshold: "warn",
  coverage_missing: "off",
  touched_workflows: "fail",
  touched_codeowners: "fail",
  touched_lockfiles: "warn",
  touched_tests: "warn",
  touched_test_config: "warn",
  touched_policy: "fail",
  tests_deleted: "fail",
  tests_removed: "fail",
  assertions_dropped: "fail",
  assertions_commented_out: "fail",
  skip_added: "fail",
  focus_added: "fail",
  trivial_assertion_added: "warn",
  claim_tests_added_unbacked: "fail",
  claim_tests_pass_unbacked: "fail",
  diff_too_large: "warn",
  secret_like_string: "fail",
  diff_unanalyzed: "warn"
};
var DEFAULT_PATHS = {
  workflows: [
    ".github/workflows/**",
    ".github/actions/**",
    ".gitlab-ci.yml",
    ".circleci/**",
    ".buildkite/**",
    "azure-pipelines.yml",
    "/Jenkinsfile",
    ".pre-commit-config.yaml"
  ],
  codeowners: ["/CODEOWNERS", ".github/CODEOWNERS", "docs/CODEOWNERS"],
  lockfiles: [
    "package-lock.json",
    "npm-shrinkwrap.json",
    "yarn.lock",
    "pnpm-lock.yaml",
    "bun.lock",
    "bun.lockb",
    "poetry.lock",
    "Pipfile.lock",
    "uv.lock",
    "pdm.lock",
    "go.sum",
    "Cargo.lock",
    "Gemfile.lock",
    "composer.lock",
    "packages.lock.json"
  ],
  tests: [
    "**/*.{test,spec}.{js,jsx,ts,tsx,mjs,cjs,mts,cts}",
    "**/__tests__/**",
    "**/test/**",
    "**/tests/**",
    "**/test_*.py",
    "**/*_test.py",
    "**/conftest.py",
    "**/*_test.go",
    "**/testdata/**"
  ],
  testConfig: [
    "jest.config.*",
    "vitest.config.*",
    "vitest.workspace.*",
    "playwright.config.*",
    "karma.conf.*",
    ".mocharc*",
    "pytest.ini",
    "tox.ini",
    ".coveragerc",
    "codecov.yml",
    ".codecov.yml"
  ],
  policy: [`/${CONFIG_FILE}`, "/.mainfast.yaml"]
};
var DEFAULT_TEST_CHECKS = [
  "/(^|[^a-z])(tests?|specs?|jest|vitest|pytest|mocha|unit|integration|e2e|rspec|go-test|gotest)([^a-z]|$)/i"
];
function defaultPolicy() {
  return {
    applyTo: "agents",
    agents: { useDefaults: true, authors: [], branchPrefixes: [], labels: [], trailers: [], emails: [] },
    flags: { ...DEFAULT_FLAGS },
    testChecks: [...DEFAULT_TEST_CHECKS],
    requiredChecks: [],
    ignoreChecks: [],
    coverage: { files: [], minChangedLinesPct: 80 },
    diff: { maxLines: 1500, maxFiles: 60, exclude: [] },
    paths: structuredClone(DEFAULT_PATHS),
    secrets: { allow: [] },
    warnConclusion: "success"
  };
}
function isObj(v) {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
function strList(v, key, warnings) {
  if (v === void 0 || v === null) return void 0;
  if (typeof v === "string") return [v];
  if (Array.isArray(v) && v.every((x) => typeof x === "string" || typeof x === "number")) return v.map(String);
  warnings.push(`${key}: expected a list of strings`);
  return void 0;
}
function num(v, key, warnings) {
  if (v === void 0 || v === null) return void 0;
  if (typeof v === "number" && Number.isFinite(v) && v >= 0) return v;
  warnings.push(`${key}: expected a non-negative number`);
  return void 0;
}
function unknownKeys(obj, allowed, prefix, warnings) {
  for (const k of Object.keys(obj)) if (!allowed.includes(k)) warnings.push(`${prefix}${k}: unknown key, ignored`);
}
function parsePolicy(yamlText) {
  const warnings = [];
  const policy = defaultPolicy();
  if (!yamlText || !yamlText.trim()) return { policy, warnings };
  let doc;
  try {
    doc = (0, import_yaml2.parse)(yamlText);
  } catch (err) {
    warnings.push(`${CONFIG_FILE}: YAML parse error, using defaults (${err.message.split("\n")[0]})`);
    return { policy, warnings };
  }
  warnings.push(...topLevelProblems(doc, CONFIG_FILE));
  if (!isObj(doc)) return { policy, warnings };
  const raw = doc[CONFIG_SECTION];
  if (raw === void 0 || raw === null) return { policy, warnings };
  if (!isObj(raw)) {
    warnings.push(`${CONFIG_SECTION}: expected a mapping`);
    return { policy, warnings };
  }
  const p = `${CONFIG_SECTION}.`;
  unknownKeys(
    raw,
    ["apply_to", "agents", "flags", "test_checks", "required_checks", "ignore_checks", "coverage", "diff", "paths", "secrets", "warn_conclusion"],
    p,
    warnings
  );
  if (raw.apply_to !== void 0) {
    if (raw.apply_to === "agents" || raw.apply_to === "all") policy.applyTo = raw.apply_to;
    else warnings.push(`${p}apply_to: expected "agents" or "all"`);
  }
  if (raw.warn_conclusion !== void 0) {
    if (raw.warn_conclusion === "success" || raw.warn_conclusion === "neutral") policy.warnConclusion = raw.warn_conclusion;
    else warnings.push(`${p}warn_conclusion: expected "success" or "neutral"`);
  }
  if (raw.agents !== void 0) {
    if (!isObj(raw.agents)) warnings.push(`${p}agents: expected a mapping`);
    else {
      const a = raw.agents;
      unknownKeys(a, ["use_defaults", "authors", "branch_prefixes", "labels", "trailers", "emails"], `${p}agents.`, warnings);
      if (a.use_defaults !== void 0) policy.agents.useDefaults = a.use_defaults !== false;
      policy.agents.authors = strList(a.authors, `${p}agents.authors`, warnings) ?? [];
      policy.agents.branchPrefixes = strList(a.branch_prefixes, `${p}agents.branch_prefixes`, warnings) ?? [];
      policy.agents.labels = strList(a.labels, `${p}agents.labels`, warnings) ?? [];
      policy.agents.emails = strList(a.emails, `${p}agents.emails`, warnings) ?? [];
      const trailers = strList(a.trailers, `${p}agents.trailers`, warnings) ?? [];
      policy.agents.trailers = trailers.filter((t) => {
        try {
          new RegExp(t, "im");
          return true;
        } catch {
          warnings.push(`${p}agents.trailers: invalid regex ${JSON.stringify(t)}`);
          return false;
        }
      });
    }
  }
  if (raw.flags !== void 0) {
    if (!isObj(raw.flags)) warnings.push(`${p}flags: expected a mapping of flag -> fail|warn|off`);
    else
      for (const [k, v] of Object.entries(raw.flags)) {
        if (!FLAG_IDS.includes(k)) {
          warnings.push(`${p}flags.${k}: unknown flag, ignored`);
          continue;
        }
        const sev = v === false ? "off" : v;
        if (sev === "fail" || sev === "warn" || sev === "off") policy.flags[k] = sev;
        else warnings.push(`${p}flags.${k}: expected fail, warn or off`);
      }
  }
  const tc = strList(raw.test_checks, `${p}test_checks`, warnings);
  if (tc) policy.testChecks = tc;
  policy.requiredChecks = strList(raw.required_checks, `${p}required_checks`, warnings) ?? [];
  policy.ignoreChecks = strList(raw.ignore_checks, `${p}ignore_checks`, warnings) ?? [];
  if (raw.coverage !== void 0) {
    if (!isObj(raw.coverage)) warnings.push(`${p}coverage: expected a mapping`);
    else {
      unknownKeys(raw.coverage, ["files", "min_changed_lines"], `${p}coverage.`, warnings);
      policy.coverage.files = strList(raw.coverage.files, `${p}coverage.files`, warnings) ?? [];
      const m = num(raw.coverage.min_changed_lines, `${p}coverage.min_changed_lines`, warnings);
      if (m !== void 0) policy.coverage.minChangedLinesPct = Math.min(100, m);
    }
  }
  if (raw.diff !== void 0) {
    if (!isObj(raw.diff)) warnings.push(`${p}diff: expected a mapping`);
    else {
      unknownKeys(raw.diff, ["max_lines", "max_files", "exclude"], `${p}diff.`, warnings);
      policy.diff.maxLines = num(raw.diff.max_lines, `${p}diff.max_lines`, warnings) ?? policy.diff.maxLines;
      policy.diff.maxFiles = num(raw.diff.max_files, `${p}diff.max_files`, warnings) ?? policy.diff.maxFiles;
      policy.diff.exclude = strList(raw.diff.exclude, `${p}diff.exclude`, warnings) ?? [];
    }
  }
  if (raw.paths !== void 0) {
    if (!isObj(raw.paths)) warnings.push(`${p}paths: expected a mapping`);
    else {
      const map = {
        workflows: "workflows",
        codeowners: "codeowners",
        lockfiles: "lockfiles",
        tests: "tests",
        test_config: "testConfig"
      };
      unknownKeys(raw.paths, Object.keys(map), `${p}paths.`, warnings);
      for (const [yamlKey, key] of Object.entries(map)) {
        const v = strList(raw.paths[yamlKey], `${p}paths.${yamlKey}`, warnings);
        if (v) policy.paths[key] = v;
      }
    }
  }
  if (raw.secrets !== void 0) {
    if (!isObj(raw.secrets)) warnings.push(`${p}secrets: expected a mapping`);
    else {
      unknownKeys(raw.secrets, ["allow"], `${p}secrets.`, warnings);
      policy.secrets.allow = (strList(raw.secrets.allow, `${p}secrets.allow`, warnings) ?? []).filter((a) => {
        try {
          new RegExp(a);
          return true;
        } catch {
          warnings.push(`${p}secrets.allow: invalid regex ${JSON.stringify(a)}`);
          return false;
        }
      });
    }
  }
  return { policy, warnings };
}
function nameMatcher(pattern) {
  const m = /^\/(.+)\/([a-z]*)$/.exec(pattern);
  if (m) {
    try {
      const re = new RegExp(m[1], m[2]);
      return (name) => re.test(name);
    } catch {
    }
  }
  const needle = pattern.toLowerCase();
  return (name) => name.toLowerCase().includes(needle);
}

// ../packages/shared/src/required-checks.ts
function resolveRequiredChecks(input2) {
  const byContext = /* @__PURE__ */ new Map();
  const add = (context, src) => {
    const list = byContext.get(context) ?? [];
    list.push(src);
    byContext.set(context, list);
  };
  const names = new Map((input2.rulesets ?? []).map((r) => [r.id, r.name]));
  let rulesetStrict;
  for (const rule of input2.branchRules ?? []) {
    if (rule.type !== "required_status_checks") continue;
    if (rule.parameters?.strict_required_status_checks_policy !== void 0)
      rulesetStrict = (rulesetStrict ?? false) || rule.parameters.strict_required_status_checks_policy;
    for (const c of rule.parameters?.required_status_checks ?? [])
      add(c.context, {
        kind: "ruleset",
        rulesetId: rule.ruleset_id,
        rulesetName: (rule.ruleset_id !== void 0 ? names.get(rule.ruleset_id) : void 0) ?? rule.ruleset_source ?? "ruleset",
        enforcement: "active",
        appId: c.integration_id ?? null
      });
  }
  const classic = input2.classic;
  if (classic) {
    const pinned = new Map((classic.checks ?? []).map((c) => [c.context, c.app_id]));
    for (const ctx of /* @__PURE__ */ new Set([...classic.contexts ?? [], ...(classic.checks ?? []).map((c) => c.context)]))
      add(ctx, { kind: "classic", appId: pinned.get(ctx) ?? null });
  }
  const required = [...byContext].map(([context, sources]) => ({
    context,
    sources: [...sources.filter((s) => s.kind === "classic"), ...sources.filter((s) => s.kind !== "classic")]
  }));
  const notEnforced = [];
  for (const r of input2.rulesets ?? []) {
    if (r.enforcement === "active") continue;
    const contexts = (r.rules ?? []).flatMap((x) => x.type === "required_status_checks" ? (x.parameters?.required_status_checks ?? []).map((c) => c.context) : []);
    if (contexts.length) notEnforced.push({ rulesetId: r.id, rulesetName: r.name, enforcement: r.enforcement, contexts });
  }
  const hasClassic = Boolean(classic && ((classic.contexts ?? []).length || (classic.checks ?? []).length));
  return { required, notEnforced, strict: { classic: hasClassic ? classic?.strict : void 0, ruleset: rulesetStrict } };
}
var requiredContexts = (set) => set.required.map((r) => r.context);
function appSatisfies(sources, appId) {
  return sources.every((s) => s.appId === null || s.appId === void 0 || s.appId === appId);
}
async function soft(notes, what, fn, fallback, why) {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof GitHubError && [403, 404].includes(e.status)) {
      const planLimit = e.status === 403 && /upgrade to github/i.test(e.body);
      const reason = planLimit ? "not available on this GitHub plan for a private repository" : why?.(e.status) ?? (e.status === 403 ? "token lacks permission" : "not found");
      notes.push(`${what}: ${e.status} (${reason}), treated as empty`);
      return fallback;
    }
    throw e;
  }
}
async function fetchRequiredSources(gh, owner, repo, branch, opts = {}) {
  const base = `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
  const b = encPath(branch);
  const notes = [];
  const info = await soft(notes, `GET ${base}/branches/${branch}`, () => gh.get(`${base}/branches/${b}`), void 0);
  let classic = null;
  const rsc = info?.protection?.required_status_checks;
  if (info?.protected && rsc && (rsc.contexts?.length || rsc.checks?.length)) {
    classic = { strict: rsc.strict, enforcement_level: rsc.enforcement_level, contexts: rsc.contexts ?? [], checks: rsc.checks ?? [] };
  } else if (info?.protected) {
    classic = await soft(
      notes,
      `GET ${base}/branches/${branch}/protection/required_status_checks`,
      () => gh.get(`${base}/branches/${b}/protection/required_status_checks`),
      null,
      (s) => s === 403 ? "needs administration: read, which GITHUB_TOKEN cannot have; classic required checks unknown" : "no classic required checks"
    );
    if (classic) classic = { ...classic, contexts: classic.contexts ?? [], checks: classic.checks ?? [] };
  }
  const branchRules = await soft(notes, `GET ${base}/rules/branches/${branch}`, () => gh.paginate(`${base}/rules/branches/${b}?per_page=100`), []);
  const rulesets = [];
  if (opts.rulesets !== false) {
    const list = await soft(notes, `GET ${base}/rulesets`, () => gh.paginate(`${base}/rulesets?includes_parents=true&per_page=100`), []);
    for (const r of list) {
      if (r.target && r.target !== "branch") continue;
      rulesets.push(await soft(notes, `GET ${base}/rulesets/${r.id}`, () => gh.get(`${base}/rulesets/${r.id}?includes_parents=true`), r));
    }
  }
  return { classic, branchRules, rulesets, headSha: typeof info?.commit?.sha === "string" ? info.commit.sha : void 0, notes };
}
var STATE_ORDER = ["failure", "timed_out", "cancelled", "action_required", "stale", "pending", "skipped", "neutral", "success"];
function checkRunState(status, conclusion) {
  if (status !== "completed") return "pending";
  switch (conclusion) {
    case "success":
    case "failure":
    case "neutral":
    case "skipped":
    case "cancelled":
    case "timed_out":
    case "action_required":
    case "stale":
      return conclusion;
    default:
      return "failure";
  }
}
function commitStatusState(state) {
  if (state === "success") return "success";
  if (state === "pending") return "pending";
  return "failure";
}
function worstState(states) {
  const known = states.filter((s) => s !== "missing");
  if (!known.length) return "missing";
  return [...known].sort((a, b) => STATE_ORDER.indexOf(a) - STATE_ORDER.indexOf(b))[0];
}
function outcomeOf(state) {
  switch (state) {
    case "success":
      return "passed";
    case "skipped":
    case "neutral":
    case "pending":
    case "stale":
    case "missing":
      return state;
    default:
      return "failed";
  }
}
function latestBy(items, key, order) {
  const by = /* @__PURE__ */ new Map();
  for (const it of items) {
    const k = key(it);
    const prev = by.get(k);
    if (!prev || order(it) >= order(prev)) by.set(k, it);
  }
  return [...by.values()];
}
var runOrder = (r) => `${r.startedAt ?? ""}|${String(r.id ?? 0).padStart(15, "0")}`;
function latestRuns(c) {
  return latestBy(
    c.runs.filter((r) => r.headSha === void 0 || r.headSha === c.sha),
    (r) => r.name,
    runOrder
  );
}
var latestStatuses = (c) => latestBy(c.statuses, (s) => s.context, (s) => s.updatedAt ?? "");
function classifyRequired(context, c, sources = []) {
  const run2 = latestRuns(c).find((r) => r.name === context);
  const status = latestStatuses(c).find((s) => s.context === context);
  const states = [];
  if (run2) states.push(checkRunState(run2.status, run2.conclusion));
  if (status) states.push(commitStatusState(status.state));
  const state = worstState(states);
  return { context, state, outcome: outcomeOf(state), run: run2, appSatisfied: !run2 || appSatisfies(sources, run2.appId) };
}

// src/analyze/checks.ts
function keeper(policy) {
  const ignored = policy.ignoreChecks.map(nameMatcher);
  return (name) => name !== CHECK_NAME && !ignored.some((m) => m(name));
}
function viewsFor(snap, policy) {
  const keep = keeper(policy);
  const runs = latestBy(
    snap.checkRuns.filter((r) => r.headSha === snap.sha && keep(r.name)),
    (r) => r.name,
    runOrder
  );
  const statuses = latestBy(
    snap.statuses.filter((s) => keep(s.context)),
    (s) => s.context,
    (s) => s.updatedAt ?? ""
  );
  return [
    ...runs.map((r) => ({
      name: r.name,
      kind: "check_run",
      state: checkRunState(r.status, r.conclusion),
      url: r.detailsUrl,
      summary: [r.outputTitle, r.outputSummary].filter(Boolean).join(" \u2014 ") || null
    })),
    ...statuses.map((s) => ({ name: s.context, kind: "status", state: commitStatusState(s.state), url: s.targetUrl, summary: s.description }))
  ].sort((a, b) => a.name.localeCompare(b.name));
}
var EMPTY_RUN = /\b(no tests? (were )?(found|ran|run|executed|collected)|0 tests?\b|collected 0 items|tests?:\s*0 total|ran 0 tests|no test files found|\[no test files\])/i;
function testsStateOf(tests) {
  if (tests.length === 0) return "none";
  if (tests.some((t) => t.state === "pending")) return "pending";
  const notOk = tests.filter((t) => t.state !== "success");
  if (notOk.length && notOk.every((t) => t.state === "skipped")) return "skipped";
  if (notOk.length) return "failed";
  if (tests.every((t) => t.summary && EMPTY_RUN.test(t.summary))) return "empty";
  return "passed";
}
function evaluateChecks(snap, policy) {
  const headSha = snap.pr.headSha;
  const findings = [];
  if (!snap.headChecks) {
    return {
      evaluated: false,
      headSha,
      all: [],
      tests: [],
      testsState: "none",
      required: [],
      requiredSources: [],
      notes: [],
      pending: false,
      findings
    };
  }
  const head = snap.headChecks.sha === headSha ? snap.headChecks : { sha: headSha, checkRuns: [], statuses: [] };
  const all = viewsFor(head, policy);
  const isTest = policy.testChecks.map(nameMatcher);
  const tests = all.filter((c) => isTest.some((m) => m(c.name)));
  const testsState = testsStateOf(tests);
  const short = headSha.slice(0, 7);
  let staleTestsOn;
  if (testsState === "none") {
    for (const prev of snap.previousChecks ?? []) {
      const pt = viewsFor(prev, policy).filter((c) => isTest.some((m) => m(c.name)));
      if (pt.length) {
        staleTestsOn = { sha: prev.sha, tests: pt };
        break;
      }
    }
    findings.push({
      id: "tests_not_run_on_head",
      title: "No test check ran on the head commit",
      detail: staleTestsOn ? `Tests ran on earlier commit ${staleTestsOn.sha.slice(0, 7)} (${staleTestsOn.tests.map((t) => `${t.name}: ${t.state}`).join(", ")}) but not on head ${short}. Evidence from an earlier commit does not cover the code being merged.` : `No check run or status on ${short} matches the test-check patterns (${policy.testChecks.join(", ")}).`
    });
  } else if (testsState === "failed") {
    const bad = tests.filter((t) => t.state !== "success");
    findings.push({
      id: "tests_failed",
      title: "Test checks did not pass on the head commit",
      detail: bad.map((t) => `${t.name}: ${t.state}`).join(", ")
    });
  } else if (testsState === "skipped") {
    const skipped2 = tests.filter((t) => t.state === "skipped");
    const ran = tests.length - skipped2.length;
    findings.push({
      id: "tests_skipped",
      title: ran ? "Some test checks were skipped on the head commit" : "Every test check was skipped on the head commit",
      detail: `${skipped2.map((t) => `${t.name}: skipped`).join(", ")} \u2014 ${ran ? `${ran} other test check(s) passed, ` : "nothing was tested on this commit; "}a skipped job (an \`if:\` or path filter) verifies nothing.`
    });
  } else if (testsState === "empty") {
    findings.push({
      id: "tests_empty",
      title: "Test checks passed but report running zero tests",
      detail: tests.map((t) => `${t.name}: "${t.summary}"`).join("; ")
    });
  }
  const contexts = [.../* @__PURE__ */ new Set([...snap.required?.contexts ?? [], ...policy.requiredChecks])].filter((c) => c !== CHECK_NAME);
  const requiredSources = [...snap.required?.sources ?? [], ...policy.requiredChecks.length ? [".mainfast.yml required_checks"] : []];
  const keep = keeper(policy);
  const commit = {
    sha: headSha,
    runs: head.checkRuns.filter((r) => keep(r.name)),
    statuses: head.statuses.filter((s) => keep(s.context))
  };
  const sourcesFor = new Map((snap.required?.checks ?? []).map((c) => [c.context, c.sources]));
  const required = contexts.map((context) => {
    const res = classifyRequired(context, commit, sourcesFor.get(context) ?? []);
    return { context, state: res.appSatisfied ? res.state : "missing", appSatisfied: res.appSatisfied };
  });
  const missing = required.filter((r) => r.state === "missing");
  const skipped = required.filter((r) => r.state === "skipped" || r.state === "neutral" || r.state === "stale");
  const failed = required.filter((r) => ["failure", "timed_out", "cancelled", "action_required"].includes(r.state));
  if (missing.length)
    findings.push({
      id: "required_check_missing",
      title: "Required check never reported on the head commit",
      detail: `${missing.map((r) => r.appSatisfied ? r.context : `${r.context} (reported by a different app than the one the rule requires)`).join(", ")} \u2014 nothing that satisfies it ran on ${short} under that name (renamed job, path filter, the workflow was edited out, or another app posted the name).`
    });
  if (skipped.length)
    findings.push({
      id: "required_check_skipped",
      title: "Required check was skipped or neutral",
      detail: `${skipped.map((r) => `${r.context}: ${r.state}`).join(", ")} \u2014 GitHub treats skipped and neutral as passing for branch protection, but nothing was verified.`
    });
  if (failed.length)
    findings.push({
      id: "required_check_failed",
      title: "Required check failed",
      detail: failed.map((r) => `${r.context}: ${r.state}`).join(", ")
    });
  const pending = testsState === "pending" || required.some((r) => r.state === "pending");
  return { evaluated: true, headSha, all, tests, testsState, staleTestsOn, required, requiredSources, notes: [...snap.headChecks.notes ?? [], ...snap.required?.notes ?? []], pending, findings };
}

// ../packages/shared/src/glob.ts
var cache = /* @__PURE__ */ new Map();
function escapeRe(s) {
  return s.replace(/[.+^${}()|[\]\\]/g, "\\$&");
}
function globToRegExp(pattern) {
  const hit = cache.get(pattern);
  if (hit) return hit;
  let p = pattern.trim();
  let anchored = false;
  if (p.startsWith("/")) {
    anchored = true;
    p = p.slice(1);
  }
  if (p.endsWith("/")) p += "**";
  if (!anchored && !p.includes("/")) p = "**/" + p;
  let re = "";
  for (let i = 0; i < p.length; i++) {
    const c = p[i];
    if (c === "*") {
      if (p[i + 1] === "*") {
        const slashAfter = p[i + 2] === "/";
        re += slashAfter ? "(?:.*/)?" : ".*";
        i += slashAfter ? 2 : 1;
      } else re += "[^/]*";
    } else if (c === "?") re += "[^/]";
    else if (c === "{") {
      const end = p.indexOf("}", i);
      if (end > i) {
        re += "(?:" + p.slice(i + 1, end).split(",").map(escapeRe).join("|") + ")";
        i = end;
      } else re += "\\{";
    } else re += escapeRe(c);
  }
  const rx = new RegExp(`^${re}(?:/.*)?$`);
  cache.set(pattern, rx);
  return rx;
}
function matchesAny(path, globs) {
  return globs.some((g) => globToRegExp(g).test(path));
}

// src/diff/patch.ts
function parseHunks(patch) {
  if (!patch) return [];
  const out = [];
  let oldLn = 0;
  let newLn = 0;
  let inHunk = false;
  for (const raw of patch.split("\n")) {
    const h = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(raw);
    if (h) {
      oldLn = Number(h[1]);
      newLn = Number(h[2]);
      inHunk = true;
      continue;
    }
    if (!inHunk) continue;
    if (raw.startsWith("\\")) continue;
    const c = raw[0];
    if (c === "+") out.push({ kind: "add", text: raw.slice(1), line: newLn++ });
    else if (c === "-") out.push({ kind: "del", text: raw.slice(1), line: oldLn++ });
    else if (c === " " || raw === "") {
      oldLn++;
      newLn++;
    } else inHunk = false;
  }
  return out;
}
function addedLines(fc) {
  return parseHunks(fc.patch).filter((l) => l.kind === "add");
}
function unquote(p) {
  if (p.startsWith('"') && p.endsWith('"')) {
    return p.slice(1, -1).replace(/\\(["\\tn])/g, (_, c) => c === "t" ? "	" : c === "n" ? "\n" : c);
  }
  return p;
}
function parseGitDiff(text) {
  const files = [];
  const chunks = text.split(/^(?=diff --git )/m).filter((c) => c.startsWith("diff --git "));
  for (const chunk of chunks) {
    const lines = chunk.split("\n");
    const header = lines[0];
    let status = "modified";
    let oldPath;
    let newPath;
    let binary = false;
    let i = 1;
    for (; i < lines.length; i++) {
      const l = lines[i];
      if (l.startsWith("@@")) break;
      if (l.startsWith("new file mode")) status = "added";
      else if (l.startsWith("deleted file mode")) status = "removed";
      else if (l.startsWith("rename from ")) {
        oldPath = unquote(l.slice(12));
        status = "renamed";
      } else if (l.startsWith("rename to ")) newPath = unquote(l.slice(10));
      else if (l.startsWith("copy from ")) {
        oldPath = unquote(l.slice(10));
        status = "copied";
      } else if (l.startsWith("copy to ")) newPath = unquote(l.slice(8));
      else if (l.startsWith("--- ")) {
        const p = unquote(l.slice(4));
        if (p !== "/dev/null") oldPath ??= p.replace(/^a\//, "");
      } else if (l.startsWith("+++ ")) {
        const p = unquote(l.slice(4));
        if (p !== "/dev/null") newPath ??= p.replace(/^b\//, "");
      } else if (l.startsWith("Binary files")) binary = true;
    }
    if (!oldPath || !newPath) {
      const m = /^diff --git (?:"?a\/(.+?)"?) (?:"?b\/(.+?)"?)$/.exec(header);
      if (m) {
        oldPath ??= m[1];
        newPath ??= m[2];
      }
    }
    const path = status === "removed" ? oldPath ?? newPath ?? "" : newPath ?? oldPath ?? "";
    const patch = binary ? void 0 : lines.slice(i).join("\n").replace(/\n$/, "") || void 0;
    const parsed = parseHunks(patch);
    files.push({
      path,
      previousPath: status === "renamed" || status === "copied" ? oldPath : void 0,
      status,
      additions: parsed.filter((d) => d.kind === "add").length,
      deletions: parsed.filter((d) => d.kind === "del").length,
      patch: binary ? void 0 : patch ?? ""
    });
  }
  return files;
}

// src/analyze/coverage.ts
function parseLcov(text) {
  const files = /* @__PURE__ */ new Map();
  let cur;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line.startsWith("SF:")) {
      const path = line.slice(3);
      cur = files.get(path) ?? { lines: /* @__PURE__ */ new Map() };
      files.set(path, cur);
    } else if (line.startsWith("DA:") && cur) {
      const [ln, hits] = line.slice(3).split(",");
      const n = Number(ln);
      const h = Number(hits);
      if (Number.isFinite(n) && Number.isFinite(h)) cur.lines.set(n, Math.max(cur.lines.get(n) ?? 0, h));
    } else if (line === "end_of_record") cur = void 0;
  }
  return { format: "lcov", files };
}
function attr(tag, name) {
  const m = new RegExp(`\\s${name}\\s*=\\s*("([^"]*)"|'([^']*)')`).exec(tag);
  return m ? m[2] ?? m[3] : void 0;
}
function decodeXml(s) {
  return s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");
}
function parseCobertura(xml) {
  const files = /* @__PURE__ */ new Map();
  const sources = [...xml.matchAll(/<source>([^<]*)<\/source>/g)].map((m) => decodeXml(m[1].trim())).filter(Boolean);
  const classRe = /<class\b([^>]*)>([\s\S]*?)<\/class>/g;
  for (const m of xml.matchAll(classRe)) {
    const filename = attr(m[1], "filename");
    if (!filename) continue;
    const rel = decodeXml(filename);
    const root = sources[0];
    const path = root && !rel.startsWith("/") ? `${root.replace(/\/+$/, "")}/${rel}` : rel;
    const cov = files.get(path) ?? { lines: /* @__PURE__ */ new Map() };
    files.set(path, cov);
    const body = m[2].replace(/<methods>[\s\S]*?<\/methods>/g, "");
    for (const l of body.matchAll(/<line\b([^>]*)\/?>/g)) {
      const n = Number(attr(l[1], "number"));
      const h = Number(attr(l[1], "hits"));
      if (Number.isFinite(n) && Number.isFinite(h)) cov.lines.set(n, Math.max(cov.lines.get(n) ?? 0, h));
    }
  }
  return { format: "cobertura", files };
}
function parseCoverage(text, nameHint = "") {
  const t = text.trimStart();
  if (t.startsWith("<") || /\.xml$/i.test(nameHint)) return parseCobertura(text);
  return parseLcov(text);
}
function mergeCoverage(reports) {
  if (!reports.length) return void 0;
  const files = /* @__PURE__ */ new Map();
  for (const r of reports)
    for (const [p, c] of r.files) {
      const into = files.get(p) ?? { lines: /* @__PURE__ */ new Map() };
      for (const [n, h] of c.lines) into.lines.set(n, Math.max(into.lines.get(n) ?? 0, h));
      files.set(p, into);
    }
  return { format: reports[0].format, files };
}
function norm(p) {
  return p.replace(/\\/g, "/").replace(/^\.\//, "");
}
function lookup(report, repoPath) {
  const target = norm(repoPath);
  let best;
  for (const [p, cov] of report.files) {
    const n = norm(p);
    if (n === target) return cov;
    if (n.endsWith(`/${target}`) || target.endsWith(`/${n}`)) {
      const len = Math.min(n.length, target.length);
      if (!best || len > best.len) best = { cov, len };
    }
  }
  return best?.cov;
}
var FORK_COVERAGE_NOTE = "not available on fork PRs (artifact comes from the fork's own CI)";
var NON_SOURCE = /\.(md|txt|json|ya?ml|toml|lock|csv|svg|png|jpe?g|gif|html?|css|scss|snap)$/i;
function evaluateCoverage(files, report, policy, unavailable) {
  const findings = [];
  if (unavailable) return { present: false, unavailable, instrumented: 0, covered: 0, uncovered: [], notInReport: [], findings };
  if (!report) {
    findings.push({ id: "coverage_missing", title: "No coverage report", detail: "No lcov or Cobertura report was provided, so changed-line coverage is unknown." });
    return { present: false, instrumented: 0, covered: 0, uncovered: [], notInReport: [], findings };
  }
  let instrumented = 0;
  let covered = 0;
  const uncovered = [];
  const notInReport = [];
  for (const f of files) {
    if (f.status === "removed" || NON_SOURCE.test(f.path) || matchesAny(f.path, policy.paths.tests)) continue;
    const added = addedLines(f);
    if (!added.length) continue;
    const cov = lookup(report, f.path);
    if (!cov) {
      notInReport.push(f.path);
      continue;
    }
    const miss = [];
    for (const l of added) {
      const h = cov.lines.get(l.line);
      if (h === void 0) continue;
      instrumented++;
      if (h > 0) covered++;
      else miss.push(l.line);
    }
    if (miss.length) uncovered.push({ path: f.path, lines: miss });
  }
  const pct = instrumented ? Math.round(covered / instrumented * 1e3) / 10 : void 0;
  if (pct !== void 0 && pct < policy.coverage.minChangedLinesPct) {
    findings.push({
      id: "coverage_below_threshold",
      title: `Changed-line coverage ${pct}% is below ${policy.coverage.minChangedLinesPct}%`,
      detail: uncovered.map((u) => `\`${u.path}\`: lines ${compress(u.lines)}`).join("\n"),
      locations: uncovered.flatMap((u) => u.lines.slice(0, 10).map((line) => ({ path: u.path, line, message: "changed line not covered by tests" })))
    });
  }
  return { present: true, format: report.format, instrumented, covered, pct, uncovered, notInReport, findings };
}
function compress(lines) {
  const s = [...lines].sort((a, b) => a - b);
  const out = [];
  for (let i = 0; i < s.length; i++) {
    let j = i;
    while (j + 1 < s.length && s[j + 1] === s[j] + 1) j++;
    out.push(j > i ? `${s[i]}-${s[j]}` : `${s[i]}`);
    i = j;
  }
  return out.join(", ");
}

// src/analyze/claims.ts
var NEGATION = /\b(no|not|n't|without|never|skip(?:ped)?|none)\b[^.\n]{0,25}$/i;
var PATTERNS = {
  tests_added: [
    /\b(?:add(?:s|ed|ing)?|wr(?:o|i)te|written|writes|includ(?:e|es|ed|ing)|new|extend(?:s|ed)?|cover(?:s|ed)? (?:it |this )?with)\b[^.\n]{0,40}?\b(?:unit |integration |e2e |regression )?tests?\b/gi,
    /\btests? (?:added|included|written|for (?:this|the (?:new|fix)))\b/gi,
    /\bwith (?:unit |integration |regression )?tests\b/gi
  ],
  tests_pass: [
    /\b(?:all )?(?:the )?(?:unit |integration )?tests? (?:pass(?:es|ed|ing)?|(?:are|is) (?:green|passing)|succeed(?:ed)?)\b/gi,
    /\b(?:ci|the build|pipeline|checks) (?:is |are )?(?:green|passing|passes|passed)\b/gi,
    /\bverified (?:that )?(?:all )?tests? pass\b/gi
  ]
};
function strip(body) {
  return body.replace(/<!--[\s\S]*?-->/g, " ").replace(/```[\s\S]*?```/g, " ");
}
function extractClaims(text) {
  const out = [];
  const body = strip(text);
  for (const [kind, res] of Object.entries(PATTERNS)) {
    for (const re of res) {
      re.lastIndex = 0;
      for (const m of body.matchAll(re)) {
        const before = body.slice(Math.max(0, (m.index ?? 0) - 30), m.index);
        const lineStart = before.lastIndexOf("\n");
        if (NEGATION.test(before.slice(lineStart + 1))) continue;
        const lineBegin = body.lastIndexOf("\n", m.index ?? 0) + 1;
        if (/^\s*[-*]\s*\[ \]/.test(body.slice(lineBegin, m.index))) continue;
        if (!out.some((c) => c.kind === kind)) out.push({ kind, quote: m[0].trim() });
      }
    }
  }
  return out;
}
function evaluateClaims(title, body, tamper, checks) {
  const claims = [];
  const findings = [];
  for (const c of extractClaims(`${title}
${body}`)) {
    if (c.kind === "tests_added") {
      const n = tamper.addedTestCases;
      if (n > 0) claims.push({ ...c, verdict: "backed", why: `${n} test case(s) added` });
      else {
        const why = tamper.testStats.length === 0 ? "the diff changes no test files" : `test files changed but no new test case was added (net assertions ${tamper.net.assertions >= 0 ? "+" : ""}${tamper.net.assertions})`;
        claims.push({ ...c, verdict: "unbacked", why });
        findings.push({ id: "claim_tests_added_unbacked", title: "Description says tests were added; the diff disagrees", detail: `"${c.quote}" \u2014 but ${why}.` });
      }
    } else {
      if (!checks.evaluated) {
        claims.push({ ...c, verdict: "unverifiable", why: "check results not available offline" });
        continue;
      }
      const s = checks.testsState;
      if (s === "passed") claims.push({ ...c, verdict: "backed", why: `test checks passed on ${checks.headSha.slice(0, 7)}` });
      else if (s === "pending") claims.push({ ...c, verdict: "pending", why: "test checks still running" });
      else {
        const why = s === "none" ? `no test check ran on head ${checks.headSha.slice(0, 7)}` : s === "empty" ? "test checks report zero tests run" : s === "skipped" ? `test checks were skipped on ${checks.headSha.slice(0, 7)}` : `test checks failed on ${checks.headSha.slice(0, 7)}`;
        claims.push({ ...c, verdict: "unbacked", why });
        findings.push({ id: "claim_tests_pass_unbacked", title: "Description says tests pass; checks on this commit disagree", detail: `"${c.quote}" \u2014 but ${why}.` });
      }
    }
  }
  return { claims, findings };
}

// src/analyze/provenance.ts
var AGENT_CATALOG = [
  {
    // Verified: claude[bot] and the claude/ prefix are the defaults of anthropics/claude-code-action
    // (action.yml `bot_name`, `branch_prefix`); the trailer, email and body footer are Claude Code's
    // default commit / PR attribution.
    id: "claude-code",
    name: "Claude Code",
    logins: ["claude[bot]"],
    branchPrefixes: ["claude/"],
    trailers: [/^co-authored-by:\s*claude\b/im],
    emails: [/^noreply@anthropic\.com$/i],
    bodyMarkers: [/generated with \[claude code\]/i]
  },
  {
    // Verified: the coding agent authors its commits as Copilot (human = co-author) with an
    // Agent-Logs-Url trailer (GitHub changelog 2026-03-20) and works on copilot/ branches; the
    // assignable actor is copilot-swe-agent (Microsoft Learn). UNVERIFIED: the `[bot]` login form.
    id: "copilot",
    name: "GitHub Copilot coding agent",
    logins: ["copilot", "copilot-swe-agent[bot]", "copilot-swe-agent"],
    branchPrefixes: ["copilot/"],
    trailers: [/^co-authored-by:\s*copilot\s*<\d+\+copilot@users\.noreply\.github\.com>/im, /^agent-logs-url:\s*https:\/\//im],
    emails: [/^\d+\+copilot@users\.noreply\.github\.com$/i],
    bodyMarkers: []
  },
  {
    // Verified: VS Code's Git extension adds this trailer when Copilot chat/agent contributed
    // (`git.addAICoAuthor`, heise 2026). Users report it on commits Copilot did not touch.
    id: "copilot-vscode",
    name: "GitHub Copilot in VS Code",
    logins: [],
    branchPrefixes: [],
    trailers: [/^co-authored-by:\s*copilot\s*<copilot@github\.com>/im],
    emails: [],
    bodyMarkers: []
  },
  {
    // Verified: chatgpt-codex-connector[bot] is the Codex GitHub app's identity (it posts Codex
    // reviews). UNVERIFIED: that it ever authors a PR or commit, the codex/ branch prefix, the
    // trailer and the task link in the PR body.
    id: "codex",
    name: "OpenAI Codex",
    logins: ["chatgpt-codex-connector[bot]"],
    branchPrefixes: ["codex/"],
    trailers: [/^co-authored-by:\s*(openai\s+)?codex\b/im],
    emails: [],
    bodyMarkers: [/chatgpt\.com\/codex\/tasks\//i]
  },
  {
    // Verified: `Co-authored-by: Cursor <cursoragent@cursor.com>` on agent commits (Cursor forum,
    // staff reply), the "Made with Cursor" attribution on Agent commits and PRs (cursor.com docs),
    // cursor/ branches for background agents (Cursor forum). UNVERIFIED: cursor[bot] as a PR author
    // (it is the Bugbot reviewer's login).
    id: "cursor",
    name: "Cursor agent",
    logins: ["cursor[bot]"],
    branchPrefixes: ["cursor/"],
    trailers: [/^co-authored-by:\s*cursor(\s+agent)?\b/im, /^made[- ]with:?\s+cursor\b/im],
    emails: [/^cursoragent@cursor\.com$/i],
    bodyMarkers: [/\bmade with \[?cursor\b/i]
  },
  {
    // Verified: devin/<timestamp>-<slug> branches and "Link to Devin run: https://…devin.ai/sessions/…"
    // in the PR body (public Devin PRs, e.g. colinhacks/zod#3893); the GitHub app is "Devin.ai
    // Integration" (docs.devin.ai) and its account devin-ai-integration opens PRs (public
    // contributor listings). UNVERIFIED: the noreply email and the co-author trailer's exact form
    // (docs.devin.ai only says a "Co-authored (Devin + you)" mode exists).
    id: "devin",
    name: "Devin",
    logins: ["devin-ai-integration[bot]"],
    branchPrefixes: ["devin/"],
    trailers: [/^co-authored-by:\s*devin\b/im],
    emails: [/devin-ai-integration\[bot\]@users\.noreply\.github\.com$/i],
    bodyMarkers: [/\b(?:app|preview)\.devin\.ai\/sessions\//i, /\blink to devin run\b/i]
  },
  {
    id: "dawnpatch",
    name: "Dawnpatch",
    logins: ["dawnpatch[bot]"],
    branchPrefixes: ["dawnpatch/"],
    trailers: [/^co-authored-by:\s*dawnpatch\b/im],
    emails: [],
    bodyMarkers: []
  },
  {
    // UNVERIFIED (from memory, not re-checked in this pass).
    id: "aider",
    name: "Aider",
    logins: [],
    branchPrefixes: ["aider/"],
    trailers: [/^co-authored-by:\s*aider\b/im, /^aider:\s/im],
    emails: [],
    bodyMarkers: []
  }
];
var DEFAULT_AGENT_LABELS = ["ai-generated", "agent-pr", "coding-agent"];
function lc(s) {
  return (s ?? "").toLowerCase();
}
function displayName(id) {
  return AGENT_CATALOG.find((a) => a.id === id)?.name ?? id;
}
function countRanges(spec) {
  let n = 0;
  for (const part of spec.split(",")) {
    const m = /^(\d+)(?:-(\d+))?$/.exec(part.trim());
    if (!m) continue;
    n += m[2] ? Number(m[2]) - Number(m[1]) + 1 : 1;
  }
  return n;
}
function parseGitAiNote(commit, note) {
  const lines = note.replace(/\r\n/g, "\n").split("\n");
  const div = lines.findIndex((l) => l === "---");
  if (div < 0) return void 0;
  const files = /* @__PURE__ */ new Set();
  let aiLines = 0;
  let current;
  for (const l of lines.slice(0, div)) {
    if (!l.trim()) continue;
    if (/^\s/.test(l)) {
      const m = /^\s+(\S+)\s+(\S+)\s*$/.exec(l);
      if (!m || !current) continue;
      if (m[1].startsWith("h_")) continue;
      aiLines += countRanges(m[2]);
      files.add(current);
    } else {
      current = l.startsWith('"') && l.endsWith('"') ? l.slice(1, -1) : l.trim();
    }
  }
  let meta = {};
  try {
    meta = JSON.parse(lines.slice(div + 1).join("\n"));
  } catch {
    return void 0;
  }
  const tools = [];
  const seen = /* @__PURE__ */ new Set();
  for (const group of [meta.prompts, meta.sessions]) {
    if (!group || typeof group !== "object") continue;
    for (const rec of Object.values(group)) {
      const agentId = rec?.agent_id;
      if (!agentId || typeof agentId.tool !== "string") continue;
      const model = typeof agentId.model === "string" ? agentId.model : void 0;
      const key = `${agentId.tool}|${model ?? ""}`;
      if (seen.has(key)) continue;
      seen.add(key);
      tools.push({ tool: agentId.tool, model });
    }
  }
  if (tools.length === 0 && aiLines === 0) return void 0;
  return {
    commit,
    tools,
    aiLines,
    files: [...files],
    schemaVersion: typeof meta.schema_version === "string" ? meta.schema_version : void 0
  };
}
var GIT_AI_TOOL_TO_AGENT = {
  claude: "claude-code",
  "claude-code": "claude-code",
  claude_code: "claude-code",
  cursor: "cursor",
  codex: "codex",
  copilot: "copilot",
  "github-copilot": "copilot",
  devin: "devin",
  aider: "aider"
};
function detectProvenance(snap, m) {
  const catalog = m.useDefaults ? AGENT_CATALOG : [];
  const labels = [...m.useDefaults ? DEFAULT_AGENT_LABELS : [], ...m.labels].map(lc);
  const signals = [];
  const add = (s) => {
    if (!signals.some((x) => x.agent === s.agent && x.source === s.source && x.detail === s.detail)) signals.push(s);
  };
  const customAuthors = m.authors.map(lc);
  const loginAgent = (login) => {
    const l = lc(login);
    if (!l) return void 0;
    const hit = catalog.find((a) => a.logins.includes(l));
    if (hit) return hit.id;
    if (customAuthors.includes(l)) return "custom";
    return void 0;
  };
  const { pr } = snap;
  const prAgent = loginAgent(pr.authorLogin);
  if (prAgent) add({ agent: prAgent, source: "pr_author", detail: `PR opened by @${pr.authorLogin}` });
  for (const a of catalog)
    for (const pre of a.branchPrefixes)
      if (pr.headRef.toLowerCase().startsWith(pre)) add({ agent: a.id, source: "branch", detail: `branch ${pr.headRef}` });
  for (const pre of m.branchPrefixes)
    if (pr.headRef.startsWith(pre)) add({ agent: "custom", source: "branch", detail: `branch ${pr.headRef}` });
  for (const l of pr.labels) if (labels.includes(lc(l))) add({ agent: "custom", source: "label", detail: `label "${l}"` });
  for (const a of catalog)
    for (const re of a.bodyMarkers) {
      const hit = re.exec(pr.body);
      if (hit) add({ agent: a.id, source: "pr_body", detail: `PR body contains "${hit[0]}"` });
    }
  const customTrailers = m.trailers.map((t) => new RegExp(t, "im"));
  const customEmails = m.emails.map(lc);
  const humanCommits = [];
  for (const c of snap.commits) {
    const before = signals.length;
    const short = c.sha.slice(0, 7);
    const ca = loginAgent(c.authorLogin);
    if (ca) add({ agent: ca, source: "commit_author", detail: `${short} authored by @${c.authorLogin}` });
    for (const a of catalog) {
      for (const re of a.trailers) {
        const hit = re.exec(c.message);
        if (hit) add({ agent: a.id, source: "trailer", detail: `${short}: ${c.message.split("\n").find((l) => re.test(l))?.trim() ?? hit[0]}` });
      }
      for (const re of a.emails)
        for (const e of [c.authorEmail, c.committerEmail])
          if (e && re.test(e)) add({ agent: a.id, source: "email", detail: `${short} ${e}` });
    }
    for (const re of customTrailers) {
      const line = c.message.split("\n").find((l) => re.test(l));
      if (line !== void 0 || re.test(c.message)) add({ agent: "custom", source: "trailer", detail: `${short}: ${(line ?? "").trim()}` });
    }
    for (const e of [c.authorEmail, c.committerEmail])
      if (e && customEmails.includes(lc(e))) add({ agent: "custom", source: "email", detail: `${short} ${e}` });
    const note = snap.gitAiNotes?.[c.sha];
    if (note) {
      const s = parseGitAiNote(c.sha, note);
      if (s) {
        for (const t of s.tools.length ? s.tools : [{ tool: "unknown" }]) {
          add({
            agent: GIT_AI_TOOL_TO_AGENT[lc(t.tool)] ?? t.tool,
            source: "git_ai",
            detail: `${short}: git-ai note, ${s.aiLines} AI line(s)${"model" in t && t.model ? `, ${t.model}` : ""}`
          });
        }
      }
    }
    if (signals.length === before && !signals.some((s) => s.detail.startsWith(short))) humanCommits.push(c.sha);
  }
  const gitAi = snap.commits.map((c) => snap.gitAiNotes?.[c.sha] ? parseGitAiNote(c.sha, snap.gitAiNotes[c.sha]) : void 0).filter((x) => !!x);
  const agents = [...new Set(signals.map((s) => s.agent === "custom" ? "custom agent (policy)" : displayName(s.agent)))];
  return { isAgent: signals.length > 0, agents, signals, gitAi, humanCommits: signals.length ? humanCommits : [] };
}

// src/analyze/secrets.ts
var SECRET_RULES = [
  { id: "aws-access-key", name: "AWS access key id", re: /\b((?:AKIA|ASIA)[0-9A-Z]{16})\b/ },
  { id: "github-token", name: "GitHub token", re: /\b(gh[pousr]_[A-Za-z0-9]{36,255}|github_pat_[A-Za-z0-9_]{60,255})\b/ },
  { id: "anthropic-key", name: "Anthropic API key", re: /\b(sk-ant-[A-Za-z0-9_-]{20,})/ },
  { id: "openai-key", name: "OpenAI API key", re: /\b(sk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{32,})/ },
  { id: "slack-token", name: "Slack token", re: /\b(xox[abposr]-[A-Za-z0-9-]{10,})/ },
  { id: "slack-webhook", name: "Slack webhook", re: /(https:\/\/hooks\.slack\.com\/services\/[A-Za-z0-9/]{20,})/ },
  { id: "stripe-key", name: "Stripe live key", re: /\b((?:sk|rk)_live_[A-Za-z0-9]{20,})/ },
  { id: "google-api-key", name: "Google API key", re: /\b(AIza[0-9A-Za-z_-]{35})\b/ },
  { id: "npm-token", name: "npm token", re: /\b(npm_[A-Za-z0-9]{36})\b/ },
  { id: "private-key", name: "Private key block", re: /(-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP |ENCRYPTED )?PRIVATE KEY(?: BLOCK)?-----)/ },
  { id: "jwt", name: "JSON Web Token", re: /\b(eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,})/ },
  {
    id: "generic-assignment",
    name: "Hard-coded credential",
    re: /(?:api[_-]?key|secret|token|passw(?:or)?d|client[_-]?secret|access[_-]?key)["']?\s*[:=]\s*["']([A-Za-z0-9+/_=.-]{20,})["']/i
  }
];
var PLACEHOLDER = /^(?:x+|\*+|0+|your[_-]|example|placeholder|changeme|dummy|fake|test|<|\$\{|\{\{)/i;
function entropy(s) {
  const freq = /* @__PURE__ */ new Map();
  for (const ch of s) freq.set(ch, (freq.get(ch) ?? 0) + 1);
  let e = 0;
  for (const n of freq.values()) {
    const p = n / s.length;
    e -= p * Math.log2(p);
  }
  return e;
}
function redact(s) {
  if (s.length <= 8) return "****";
  return `${s.slice(0, 4)}\u2026${s.slice(-2)} (${s.length} chars)`;
}
function scanSecrets(files, policy) {
  const allow = policy.secrets.allow.flatMap((a) => {
    try {
      return [new RegExp(a)];
    } catch {
      return [];
    }
  });
  const hits = [];
  for (const f of files) {
    if (f.status === "removed" || matchesAny(f.path, policy.paths.lockfiles)) continue;
    for (const l of addedLines(f)) {
      for (const rule of SECRET_RULES) {
        const m = rule.re.exec(l.text);
        if (!m) continue;
        const value = m[1] ?? m[0];
        if (allow.some((a) => a.test(value))) continue;
        if (rule.id === "generic-assignment" && (PLACEHOLDER.test(value) || entropy(value) < 3.5)) continue;
        hits.push({ path: f.path, line: l.line, rule: rule.name, redacted: rule.id === "private-key" ? value : redact(value) });
        break;
      }
    }
  }
  const findings = hits.length ? [
    {
      id: "secret_like_string",
      title: "Secret-like strings added",
      detail: hits.map((h) => `\`${h.path}:${h.line}\` ${h.rule} ${h.redacted}`).join("\n"),
      locations: hits.map((h) => ({ path: h.path, line: h.line, message: `${h.rule} (${h.redacted}). Rotate it if real.` }))
    }
  ] : [];
  return { hits, findings };
}

// src/analyze/size.ts
function evaluateSize(files, policy) {
  const skip = [...policy.paths.lockfiles, ...policy.diff.exclude];
  const counted = files.filter((f) => !matchesAny(f.path, skip));
  const lines = counted.reduce((n, f) => n + f.additions + f.deletions, 0);
  const findings = [];
  const over = [];
  if (policy.diff.maxLines > 0 && lines > policy.diff.maxLines) over.push(`${lines} changed lines (limit ${policy.diff.maxLines})`);
  if (policy.diff.maxFiles > 0 && counted.length > policy.diff.maxFiles) over.push(`${counted.length} files (limit ${policy.diff.maxFiles})`);
  if (over.length) findings.push({ id: "diff_too_large", title: "Diff is larger than the policy allows", detail: `${over.join(", ")}. Large agent PRs hide changes; split it.` });
  return {
    files: files.length,
    additions: files.reduce((n, f) => n + f.additions, 0),
    deletions: files.reduce((n, f) => n + f.deletions, 0),
    counted: { files: counted.length, lines },
    findings
  };
}

// src/analyze/tamper.ts
var LANG_RULES = {
  js: {
    testCase: /(?:^|[\s;(,])[xf]?(?:it|test)(?:\.[a-zA-Z]+)*\s*(?:\(|`)/,
    assertion: /\bexpect\s*\(|\bexpect\.(?:assertions|hasAssertions)\s*\(|\bassert(?:\.[a-zA-Z]+)?\s*\(|\.should\b|\bt\.(?:is|not|deepEqual|notDeepEqual|true|false|truthy|falsy|throws|throwsAsync|regex|snapshot|like)\s*\(/g,
    skip: /\b(?:it|test|describe|context|suite)\.(?:skip|todo|skipIf)\b|(?:^|[^\w.])x(?:it|test|describe|context)\s*\(|\bthis\.skip\s*\(/,
    focus: /\b(?:it|test|describe|context|suite)\.only\b|(?:^|[^\w.])f(?:it|describe)\s*\(/,
    trivial: /\bexpect\s*\(\s*(true|false|1|0|null|undefined|'[^']*'|"[^"]*")\s*\)\s*\.\s*(?:toBe|toEqual|toStrictEqual)\s*\(\s*\1\s*\)|\bexpect\s*\(\s*(?:true|1)\s*\)\s*\.\s*toBeTruthy\s*\(\s*\)|\bassert(?:\.ok)?\s*\(\s*true\s*\)/,
    comment: /^\s*(?:\/\/|\/\*|\*)/
  },
  python: {
    testCase: /^\s*(?:async\s+)?def\s+test\w*\s*\(/,
    assertion: /(?:^|\s)assert[\s(]|\bself\.assert[A-Z]\w*\s*\(|\bpytest\.raises\s*\(|\bself\.fail\s*\(/g,
    skip: /@pytest\.mark\.(?:skip|skipif|xfail)\b|@unittest\.(?:skip|skipIf|skipUnless|expectedFailure)\b|\bpytest\.(?:skip|xfail)\s*\(|\bself\.skipTest\s*\(/,
    trivial: /^\s*assert\s+(?:True|1|not\s+False)\s*(?:$|#)|\bself\.assertTrue\(\s*True\s*\)|^\s*assert\s+(\w+)\s*==\s*\1\s*(?:$|#)/,
    comment: /^\s*#/
  },
  go: {
    testCase: /^func\s+(?:Test|Fuzz)\w*\s*\(|\bt\.Run\s*\(/,
    assertion: /\bt\.(?:Error|Errorf|Fatal|Fatalf|Fail|FailNow)\s*\(|\b(?:assert|require)\.[A-Z]\w*\s*\(/g,
    skip: /\bt\.(?:Skip|Skipf|SkipNow)\s*\(/,
    trivial: /\b(?:assert|require)\.True\(\s*t\s*,\s*true\s*\)|\b(?:assert|require)\.Equal\(\s*t\s*,\s*(\w+|"[^"]*")\s*,\s*\1\s*\)/,
    comment: /^\s*(?:\/\/|\/\*|\*)/
  }
};
function langOf(path) {
  if (/\.(?:[cm]?[jt]sx?)$/.test(path)) return "js";
  if (/\.py$/.test(path)) return "python";
  if (/\.go$/.test(path)) return "go";
  return void 0;
}
function countMatches(re, text) {
  re.lastIndex = 0;
  return (text.match(re) ?? []).length;
}
function stripComment(text, lang) {
  return lang === "python" ? text.replace(/^\s*#\s?/, "") : text.replace(/^\s*(?:\/\/|\/\*+|\*)\s?/, "");
}
function analyzeTestFile(fc) {
  const lang = langOf(fc.path);
  if (!lang) return void 0;
  const r = LANG_RULES[lang];
  const st = {
    path: fc.path,
    lang,
    status: fc.status,
    assertionsAdded: 0,
    assertionsRemoved: 0,
    casesAdded: 0,
    casesRemoved: 0,
    skips: [],
    focus: [],
    trivial: [],
    commentedOut: []
  };
  const lines = parseHunks(fc.patch);
  const removedText = new Set(lines.filter((l) => l.kind === "del").map((l) => l.text.trim()));
  for (const l of lines) {
    const isComment = r.comment.test(l.text);
    if (isComment) {
      if (l.kind === "add" && countMatches(r.assertion, stripComment(l.text, lang)) > 0) st.commentedOut.push(l);
      continue;
    }
    const a = countMatches(r.assertion, l.text);
    const c = r.testCase.test(l.text) ? 1 : 0;
    if (l.kind === "add") {
      const trivial = r.trivial.test(l.text);
      st.assertionsAdded += trivial ? 0 : a;
      st.casesAdded += c;
      const fresh = !removedText.has(l.text.trim());
      if (fresh && r.skip.test(l.text)) st.skips.push(l);
      if (fresh && r.focus?.test(l.text)) st.focus.push(l);
      if (trivial) st.trivial.push(l);
    } else {
      st.assertionsRemoved += a;
      st.casesRemoved += c;
    }
  }
  return st;
}
function evaluateTamper(files, policy) {
  const P2 = policy.paths;
  const paths = (f) => [f.path, ...f.previousPath ? [f.previousPath] : []];
  const hit = (globs) => files.filter((f) => paths(f).some((p) => matchesAny(p, globs))).map((f) => f.path);
  const tests = files.filter((f) => paths(f).some((p) => matchesAny(p, P2.tests)));
  const touched = {
    workflows: hit(P2.workflows),
    codeowners: hit(P2.codeowners),
    lockfiles: hit(P2.lockfiles),
    // New tests are welcome; removing lines from, renaming or deleting existing test files is what we flag.
    tests: tests.filter((f) => f.status !== "added" && (f.deletions > 0 || f.status === "removed" || f.status === "renamed")).map((f) => f.path),
    testConfig: hit(P2.testConfig),
    policy: hit(P2.policy)
  };
  const unanalyzed = files.filter((f) => f.patch === void 0 && f.additions + f.deletions > 0).map((f) => f.path);
  const testStats = tests.map(analyzeTestFile).filter((s) => !!s);
  const net = {
    assertions: testStats.reduce((n, s) => n + s.assertionsAdded - s.assertionsRemoved, 0),
    cases: testStats.reduce((n, s) => n + s.casesAdded - s.casesRemoved, 0)
  };
  const addedTestCases = testStats.reduce((n, s) => n + s.casesAdded, 0);
  const findings = [];
  const list = (xs) => xs.map((x) => `\`${x}\``).join(", ");
  if (touched.workflows.length)
    findings.push({ id: "touched_workflows", title: "CI workflow files changed", detail: `${list(touched.workflows)} \u2014 a PR that edits its own CI can change what "passing" means.` });
  if (touched.codeowners.length)
    findings.push({ id: "touched_codeowners", title: "CODEOWNERS changed", detail: `${list(touched.codeowners)} \u2014 changes who must review.` });
  if (touched.policy.length)
    findings.push({ id: "touched_policy", title: "Evidence policy file changed", detail: `${list(touched.policy)} \u2014 this run used the base branch policy, not the PR's.` });
  if (touched.lockfiles.length) findings.push({ id: "touched_lockfiles", title: "Lockfiles changed", detail: list(touched.lockfiles) });
  if (touched.tests.length) findings.push({ id: "touched_tests", title: "Existing tests changed (lines removed, renamed or deleted)", detail: list(touched.tests) });
  if (touched.testConfig.length) findings.push({ id: "touched_test_config", title: "Test or coverage config changed", detail: list(touched.testConfig) });
  const deleted = tests.filter((f) => f.status === "removed").map((f) => f.path);
  if (deleted.length) findings.push({ id: "tests_deleted", title: "Test files deleted", detail: list(deleted) });
  const perFile = (pick2) => testStats.filter((s) => pick2(s) < 0).map((s) => `\`${s.path}\` (${pick2(s)})`).join(", ");
  if (net.cases < 0)
    findings.push({
      id: "tests_removed",
      title: "Fewer test cases than before",
      detail: `Net ${net.cases} test case(s) across the diff. Per file: ${perFile((s) => s.casesAdded - s.casesRemoved)}.`
    });
  if (net.assertions < 0)
    findings.push({
      id: "assertions_dropped",
      title: "Assertion count dropped",
      detail: `Net ${net.assertions} assertion(s) across test files. Per file: ${perFile((s) => s.assertionsAdded - s.assertionsRemoved)}.`
    });
  const loc = (kind, pick2) => testStats.flatMap((s) => pick2(s).map((l) => ({ path: s.path, line: l.line, message: `${kind}: ${l.text.trim().slice(0, 160)}` })));
  const lineFinding = (id, title, kind, pick2) => {
    const locations = loc(kind, pick2);
    if (locations.length)
      findings.push({ id, title, detail: locations.map((l) => `\`${l.path}:${l.line}\` ${l.message.slice(kind.length + 2)}`).join("\n"), locations });
  };
  lineFinding("skip_added", "Tests skipped", "skip added", (s) => s.skips);
  lineFinding("focus_added", "Focused test added (.only / fit) \u2014 other tests in the file stop running", "focus added", (s) => s.focus);
  lineFinding("assertions_commented_out", "Assertions commented out", "commented-out assertion", (s) => s.commentedOut);
  lineFinding("trivial_assertion_added", "Assertion that cannot fail", "trivial assertion", (s) => s.trivial);
  if (unanalyzed.length)
    findings.push({
      id: "diff_unanalyzed",
      title: "Some files could not be analysed",
      detail: `GitHub returned no patch for ${list(unanalyzed)} (diff too large). Run with a full checkout to analyse them locally.`
    });
  return { touched, testStats, net, addedTestCases, unanalyzed, findings };
}

// src/evaluate.ts
function evaluate(snap, policy, policyWarnings = []) {
  const provenance = detectProvenance(snap, policy.agents);
  const applies = policy.applyTo === "all" || provenance.isAgent;
  const appliesReason = policy.applyTo === "all" ? "policy applies to every PR" : provenance.isAgent ? `agent PR (${provenance.agents.join(", ")})` : "no agent signal found";
  const checks = evaluateChecks(snap, policy);
  const tamper = evaluateTamper(snap.files, policy);
  const coverage = evaluateCoverage(snap.files, snap.coverage, policy, snap.coverageUnavailable);
  const { claims, findings: claimFindings } = evaluateClaims(snap.pr.title, snap.pr.body, tamper, checks);
  const size = evaluateSize(snap.files, policy);
  const secrets = scanSecrets(snap.files, policy);
  const findings = [...checks.findings, ...tamper.findings, ...coverage.findings, ...claimFindings, ...size.findings, ...secrets.findings];
  const flags = [];
  if (applies)
    for (const f of findings) {
      const sev = policy.flags[f.id];
      if (sev === "off") continue;
      flags.push({ ...f, severity: sev });
    }
  flags.sort((a, b) => a.severity === b.severity ? 0 : a.severity === "fail" ? -1 : 1);
  let conclusion = "success";
  if (applies) {
    if (flags.some((f) => f.severity === "fail")) conclusion = "failure";
    else if (checks.pending) conclusion = "pending";
    else if (flags.length) conclusion = policy.warnConclusion;
  }
  return {
    repo: snap.repo,
    pr: snap.pr,
    applies,
    appliesReason,
    provenance,
    checks,
    tamper,
    coverage,
    claims,
    size,
    secrets: secrets.hits,
    flags,
    conclusion,
    policyWarnings
  };
}

// src/github/api.ts
var enc2 = encodeURIComponent;
var RestClient = class {
  /** The shared transport, for callers that need plain REST (the plan gate). */
  gh;
  constructor(token, opts = {}) {
    this.gh = new GitHub({ token, apiUrl: opts.baseUrl ?? DEFAULT_API_URL, userAgent: USER_AGENT, fetch: opts.fetch });
  }
  async raw(method, pathOrUrl, body) {
    const res = await this.gh.request(method, pathOrUrl, body);
    return { data: res.data, next: parseNextLink(res.headers.get("link")) };
  }
  async paginate(path, pick2, max = 3e3) {
    const out = [];
    let url = `${path}${path.includes("?") ? "&" : "?"}per_page=100`;
    while (url && out.length < max) {
      const { data, next } = await this.raw("GET", url);
      out.push(...pick2 ? pick2(data) : data);
      url = next;
    }
    return out;
  }
  getPull(o, r, n) {
    return this.raw("GET", `/repos/${enc2(o)}/${enc2(r)}/pulls/${n}`).then((x) => x.data);
  }
  listPullCommits(o, r, n) {
    return this.paginate(`/repos/${enc2(o)}/${enc2(r)}/pulls/${n}/commits`, void 0, 250);
  }
  listPullFiles(o, r, n) {
    return this.paginate(`/repos/${enc2(o)}/${enc2(r)}/pulls/${n}/files`);
  }
  listCheckRunsForRef(o, r, ref, checkName) {
    const q = checkName ? `?check_name=${enc2(checkName)}&filter=latest` : "?filter=latest";
    return this.paginate(`/repos/${enc2(o)}/${enc2(r)}/commits/${enc2(ref)}/check-runs${q}`, (d) => d.check_runs);
  }
  listStatusesForRef(o, r, ref) {
    return this.paginate(`/repos/${enc2(o)}/${enc2(r)}/commits/${enc2(ref)}/status`, (d) => d.statuses);
  }
  listPullsForCommit(o, r, sha) {
    return this.paginate(`/repos/${enc2(o)}/${enc2(r)}/commits/${enc2(sha)}/pulls`, void 0, 100);
  }
  listOpenPulls(o, r, opts = {}) {
    const head = opts.head ? `&head=${enc2(opts.head)}` : "";
    return this.paginate(`/repos/${enc2(o)}/${enc2(r)}/pulls?state=open&sort=updated&direction=desc${head}`, void 0, opts.max ?? 300);
  }
  getFileContent(o, r, path, ref) {
    return this.gh.getFileText(o, r, path, ref);
  }
  async getAuthenticatedLogin() {
    try {
      const { data } = await this.raw("GET", "/user");
      const login = data?.login;
      return typeof login === "string" && login ? login : void 0;
    } catch {
      return void 0;
    }
  }
  listIssueComments(o, r, n) {
    return this.paginate(`/repos/${enc2(o)}/${enc2(r)}/issues/${n}/comments`);
  }
  createIssueComment(o, r, n, body) {
    return this.raw("POST", `/repos/${enc2(o)}/${enc2(r)}/issues/${n}/comments`, { body }).then((x) => x.data);
  }
  updateIssueComment(o, r, id, body) {
    return this.raw("PATCH", `/repos/${enc2(o)}/${enc2(r)}/issues/comments/${id}`, { body }).then((x) => x.data);
  }
  createCheckRun(o, r, body) {
    return this.raw("POST", `/repos/${enc2(o)}/${enc2(r)}/check-runs`, body).then((x) => x.data);
  }
  updateCheckRun(o, r, id, body) {
    return this.raw("PATCH", `/repos/${enc2(o)}/${enc2(r)}/check-runs/${id}`, body).then((x) => x.data);
  }
};

// src/github/collect.ts
function mapPull(p) {
  return {
    number: p.number,
    title: p.title ?? "",
    body: p.body ?? "",
    authorLogin: p.user?.login ?? "",
    authorType: p.user?.type ?? "User",
    headRef: p.head.ref,
    headSha: p.head.sha,
    baseRef: p.base.ref,
    baseSha: p.base.sha,
    labels: (p.labels ?? []).map((l) => l.name),
    htmlUrl: p.html_url
  };
}
function mapCommit(c) {
  return {
    sha: c.sha,
    message: c.commit.message ?? "",
    authorName: c.commit.author?.name ?? "",
    authorEmail: c.commit.author?.email ?? "",
    committerName: c.commit.committer?.name,
    committerEmail: c.commit.committer?.email,
    authorLogin: c.author?.login,
    authorType: c.author?.type
  };
}
var STATUSES = ["added", "removed", "modified", "renamed", "copied", "changed", "unchanged"];
function mapFile(f) {
  return {
    path: f.filename,
    previousPath: f.previous_filename,
    status: STATUSES.includes(f.status) ? f.status : "modified",
    additions: f.additions,
    deletions: f.deletions,
    patch: f.patch
  };
}
function mapChecks(sha, runs, statuses) {
  return {
    sha,
    checkRuns: runs.map((r) => ({
      id: r.id,
      name: r.name,
      headSha: r.head_sha,
      status: r.status,
      conclusion: r.conclusion,
      appSlug: r.app?.slug,
      appId: r.app?.id ?? null,
      startedAt: r.started_at,
      completedAt: r.completed_at,
      outputTitle: r.output?.title ?? null,
      outputSummary: r.output?.summary ?? null,
      detailsUrl: r.html_url ?? r.details_url
    })),
    statuses: statuses.map((s) => ({ context: s.context, state: s.state, description: s.description, targetUrl: s.target_url, updatedAt: s.updated_at }))
  };
}
async function fetchChecks(api, owner, repo, sha) {
  const notes = [];
  const [runs, statuses] = await Promise.all([
    api.listCheckRunsForRef(owner, repo, sha),
    // The combined status needs "Commit statuses: read"; a workflow that does not grant it still
    // gets a card (check runs only) and a note instead of an error.
    api.listStatusesForRef(owner, repo, sha).catch((err) => {
      if (err instanceof GitHubError && [403, 404].includes(err.status)) {
        notes.push(`commit statuses on ${sha.slice(0, 7)}: ${err.status} (grant statuses: read to see them), treated as none`);
        return [];
      }
      throw err;
    })
  ]);
  return { ...mapChecks(sha, runs, statuses), ...notes.length ? { notes } : {} };
}
async function fetchRequired(api, owner, repo, branch) {
  const snap = await fetchRequiredSources(api.gh, owner, repo, branch, { rulesets: false });
  const set = resolveRequiredChecks({ classic: snap.classic, branchRules: snap.branchRules });
  const sources = [];
  const rulesNote = snap.notes.some((n) => n.includes("/rules/branches/"));
  if (!rulesNote) {
    const any = snap.branchRules.some((r) => r.type === "required_status_checks" && (r.parameters?.required_status_checks ?? []).length > 0);
    sources.push(any ? "rulesets" : "rulesets (none required)");
  }
  if (snap.classic) sources.push("branch protection");
  return { contexts: requiredContexts(set), sources, checks: set.required, notes: snap.notes };
}
async function fetchPolicyText(api, owner, repo, baseSha) {
  return await api.getFileContent(owner, repo, CONFIG_FILE, baseSha) ?? await api.getFileContent(owner, repo, ".mainfast.yaml", baseSha);
}
async function collectSnapshot(api, repoFull, prNumber, policy, opts = {}) {
  const [owner, repo] = repoFull.split("/");
  const pull = opts.pull ?? await api.getPull(owner, repo, prNumber);
  const pr = mapPull(pull);
  const [commits, files, headChecks, required] = await Promise.all([
    api.listPullCommits(owner, repo, prNumber).then((cs) => cs.map(mapCommit)),
    api.listPullFiles(owner, repo, prNumber).then((fs) => fs.map(mapFile)),
    fetchChecks(api, owner, repo, pr.headSha),
    fetchRequired(api, owner, repo, pr.baseRef)
  ]);
  const isTest = policy.testChecks.map(nameMatcher);
  const headHasTests = [...headChecks.checkRuns.map((r) => r.name), ...headChecks.statuses.map((s) => s.context)].some((n) => isTest.some((m) => m(n)));
  const previousChecks = [];
  if (!headHasTests) {
    const earlier = commits.filter((c) => c.sha !== pr.headSha).reverse().slice(0, opts.previousCommitsToCheck ?? 3);
    for (const c of earlier) previousChecks.push(await fetchChecks(api, owner, repo, c.sha));
  }
  return { repo: repoFull, pr, commits, files, headChecks, previousChecks, required };
}

// src/fixes.ts
var FLAG_FIXES = {
  tests_not_run_on_head: "Run the test workflow on this commit (push again or re-run CI); evidence from an earlier push does not count.",
  tests_failed: "Fix the failing tests on this commit, or have the agent fix them, then push.",
  tests_skipped: "Make the test job run on this commit (check its `if:` and path filters), or set `tests_skipped: fail` to require it.",
  tests_empty: "Point the test job at the real tests (glob, working directory, test discovery) so it runs more than zero.",
  required_check_missing: "Restore the job name the ruleset requires (or update the ruleset after a rename), and drop path filters on required jobs.",
  required_check_skipped: "Make required jobs always run and report, or move the condition inside a step; GitHub counts skipped as passing.",
  required_check_failed: "Fix the failing required check; set `required_check_failed: fail` to show it as a failure here too.",
  coverage_below_threshold: "Add tests for the changed lines, or lower `coverage.min_changed_lines`.",
  coverage_missing: "Upload lcov or Cobertura from CI and pass it as `coverage-files` (or `coverage.files`).",
  touched_workflows: "Have a human review the CI change, or move it to its own PR; agents should not edit what judges them.",
  touched_codeowners: "Have a code owner review the CODEOWNERS change in a separate, human-authored PR.",
  touched_lockfiles: "Check the dependency change is intended (`npm ci` / lockfile diff), or set `touched_lockfiles: off`.",
  touched_tests: "Check each removed or rewritten test line is intended; keep the old assertions unless the behaviour changed.",
  touched_test_config: "Review the test-config change: coverage thresholds, excluded paths and test globs can switch tests off.",
  touched_policy: "Change `.mainfast.yml` in a separate, human-reviewed PR; this PR is judged by the base branch's policy anyway.",
  tests_deleted: "Restore the deleted test file, or explain in the PR why the behaviour it covered is gone.",
  tests_removed: "Restore the removed test cases, or replace them with equivalent ones.",
  assertions_dropped: "Restore the dropped assertions; a test without them passes whatever the code does.",
  assertions_commented_out: "Uncomment the assertion and fix the code it was catching, or delete it on purpose with a reason.",
  skip_added: "Remove the skip marker and fix the test, or open an issue and link it next to the skip.",
  focus_added: "Remove `.only` / `fit` / `fdescribe`; they stop every other test in the file.",
  trivial_assertion_added: "Replace the always-true assertion with one that checks the code's result.",
  claim_tests_added_unbacked: "Add the tests the description promises, or correct the description.",
  claim_tests_pass_unbacked: "Wait for the test checks on this commit to pass, or correct the description.",
  diff_too_large: "Split the PR, or raise `diff.max_lines` / `diff.max_files` (generated files can go in `diff.exclude`).",
  secret_like_string: "Remove the value and rotate it if it is real; add a known fake to `secrets.allow` (anchored, `^\u2026$`).",
  diff_unanalyzed: "Run the Action in a full checkout (`fetch-depth: 0`) so the diff is computed locally, not from truncated API patches."
};

// ../packages/shared/src/markdown.ts
var MAX_INLINE = 500;
var NEWLINES = /\r\n|[\r\n\u2028\u2029\u0085]/g;
var CONTROL = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g;
function cap(s, max) {
  const cps = Array.from(s);
  return cps.length <= max ? s : `${cps.slice(0, Math.max(0, max - 1)).join("")}\u2026`;
}
function oneLine(s) {
  return s.replace(NEWLINES, " ").replace(/\t/g, " ").replace(CONTROL, "");
}
var MD_SPECIAL = /[&<>\\`*_[\]()!#|~]/g;
var HTML = { "&": "&amp;", "<": "&lt;", ">": "&gt;" };
function noMentions(s) {
  return s.replace(/@(?=[A-Za-z0-9])/g, "@\u200B");
}
function mdText(s, max = MAX_INLINE) {
  return noMentions(cap(oneLine(s), max).replace(MD_SPECIAL, (ch) => HTML[ch] ?? `\\${ch}`));
}
function mdCode(s, max = MAX_INLINE) {
  const body = cap(oneLine(s), max);
  if (!body.trim()) return mdText(body);
  const longest = Math.max(0, ...(body.match(/`+/g) ?? []).map((r) => r.length));
  const fence = "`".repeat(longest + 1);
  const pad = /^[` ]|[` ]$/.test(body) ? " " : "";
  return `${fence}${pad}${body}${pad}${fence}`;
}
function mdInline(s, max = MAX_INLINE) {
  const t = cap(oneLine(s), max);
  let out = "";
  let last = 0;
  for (const m of t.matchAll(/`([^`]+)`/g)) {
    out += mdText(t.slice(last, m.index), Infinity) + mdCode(m[1], Infinity);
    last = m.index + m[0].length;
  }
  return out + mdText(t.slice(last), Infinity);
}
function plainText(s, max, singleLine = false) {
  const t = singleLine ? oneLine(s) : s.replace(/\r\n?/g, "\n").replace(CONTROL, "");
  return cap(t, max);
}
function safeUrl(u) {
  return u && /^https:\/\/[^\s()<>\\`"']+$/.test(u) ? u : void 0;
}

// src/render.ts
var MAX_SUMMARY = 65e3;
var MAX_CELL_ITEM = 200;
var MAX_LIST = 20;
var MD = { t: (s, max) => mdText(s, max), i: (s) => mdInline(s), code: (s, max) => mdCode(s, max) };
function joinCapped(items, sep) {
  const shown = items.slice(0, MAX_LIST).join(sep);
  return items.length > MAX_LIST ? `${shown}${sep}+${items.length - MAX_LIST} more` : shown;
}
function headline(r, e = (s) => s) {
  const fails = r.flags.filter((f) => f.severity === "fail").length;
  const warns = r.flags.length - fails;
  if (!r.applies) return "Not an agent PR";
  const parts = [fails ? `${fails} failing` : "", warns ? `${warns} warning${warns > 1 ? "s" : ""}` : ""].filter(Boolean);
  if (r.conclusion === "pending") return `Waiting for checks on ${e(r.pr.headSha.slice(0, 7))}${parts.length ? ` (${parts.join(", ")} so far)` : ""}`;
  return parts.length ? parts.join(", ") : "All evidence present";
}
function checkTitle(r) {
  return headline(r);
}
function badge(r) {
  if (!r.applies) return "PASS";
  return { success: "PASS", failure: "FAIL", neutral: "WARN", pending: "PENDING" }[r.conclusion];
}
function testsCell(r, e = MD) {
  const c = r.checks;
  if (!c.evaluated) return "not evaluated (offline)";
  const names = joinCapped(c.tests.map((t) => `${e.t(t.name, MAX_CELL_ITEM)}: ${e.t(t.state, 40)}`), ", ");
  switch (c.testsState) {
    case "passed":
      return `passed \u2014 ${names}`;
    case "failed":
      return `FAILED \u2014 ${names}`;
    case "pending":
      return `running \u2014 ${names}`;
    case "skipped":
      return `SKIPPED \u2014 ${names}`;
    case "empty":
      return `ran zero tests \u2014 ${names}`;
    case "none":
      return c.staleTestsOn ? `NONE on this commit (last ran on ${e.t(c.staleTestsOn.sha.slice(0, 7))})` : "NONE on this commit";
  }
}
function requiredCell(r, e = MD) {
  const c = r.checks;
  if (!c.evaluated) return "not evaluated (offline)";
  const unknown = c.notes.some((n) => /classic required checks unknown/.test(n)) ? " (classic protection unreadable; list them in `required_checks`)" : "";
  if (!c.required.length)
    return c.requiredSources.length ? `none configured${unknown}` : "unknown (no ruleset/protection readable; set `required_checks`)";
  const ok = c.required.filter((x) => x.state === "success").length;
  const bad = c.required.filter((x) => x.state !== "success").map((x) => `${e.t(x.context, MAX_CELL_ITEM)}: ${e.t(x.state, 40)}`);
  return `${ok}/${c.required.length} passed${bad.length ? ` \u2014 ${joinCapped(bad, ", ")}` : ""}${unknown}`;
}
function coverageCell(r, e = MD) {
  const c = r.coverage;
  if (c.unavailable) return c.unavailable;
  if (!c.present) return "no report";
  const format = e.t(String(c.format), 40);
  if (c.pct === void 0) return `no instrumented changed lines (${format})`;
  return `${c.pct}% (${c.covered}/${c.instrumented} changed lines, ${format})${c.notInReport.length ? `; ${c.notInReport.length} changed file(s) not in report` : ""}`;
}
function tamperCell(r) {
  const t = r.tamper.touched;
  const parts = [
    ["workflows", t.workflows],
    ["CODEOWNERS", t.codeowners],
    ["policy", t.policy],
    ["test config", t.testConfig],
    ["existing tests", t.tests],
    ["lockfiles", t.lockfiles]
  ].filter(([, v]) => v.length).map(([k, v]) => `${k} (${v.length})`);
  const w = [];
  const s = r.tamper.testStats;
  const skips = s.reduce((n, x) => n + x.skips.length + x.focus.length, 0);
  if (skips) w.push(`${skips} skip/focus marker(s)`);
  if (r.tamper.net.assertions < 0) w.push(`assertions ${r.tamper.net.assertions}`);
  if (r.tamper.net.cases < 0) w.push(`test cases ${r.tamper.net.cases}`);
  return [...parts, ...w].join(", ") || "nothing sensitive touched";
}
function claimsCell(r, e = MD) {
  if (!r.claims.length) return "no testable claims";
  return joinCapped(r.claims.map((c) => `"${e.t(c.quote, MAX_CELL_ITEM)}": ${c.verdict === "unbacked" ? "UNBACKED" : e.t(c.verdict, 40)}`), "; ");
}
function renderCard(r, opts = {}) {
  const short = r.pr.headSha.slice(0, 7);
  const lines = [];
  if (opts.marker !== false) lines.push(COMMENT_MARKER);
  lines.push(`### ${PRODUCT_NAME}: ${badge(r)} \u2014 ${headline(r, (s) => mdText(s))}`);
  const meta = [`head ${mdCode(short)}`, r.provenance.agents.length ? r.provenance.agents.map((a) => mdText(a, 60)).join(", ") : "no agent detected"];
  const checkUrl = safeUrl(opts.checkUrl);
  if (checkUrl) meta.push(`[check run](${checkUrl})`);
  lines.push(meta.join(" \xB7 "), "");
  if (!r.applies) lines.push(`${mdText(r.appliesReason)}; this repository's policy gates agent PRs only (${mdCode("apply_to: all")} gates every PR).`, "");
  if (r.applies) {
    lines.push("| Evidence | On this commit |", "|---|---|");
    lines.push(`| Tests ran | ${testsCell(r)} |`);
    lines.push(`| Required checks | ${requiredCell(r)} |`);
    lines.push(`| Changed-line coverage | ${coverageCell(r)} |`);
    lines.push(`| Sensitive files / test weakening | ${tamperCell(r)} |`);
    lines.push(`| Description claims | ${claimsCell(r)} |`);
    lines.push(`| Diff size | +${r.size.additions} \u2212${r.size.deletions} in ${r.size.files} file(s) |`);
    lines.push(`| Secret-like strings | ${r.secrets.length ? `${r.secrets.length} found` : "none"} |`, "");
    const section = (sev, heading) => {
      const fs = r.flags.filter((f) => f.severity === sev);
      if (!fs.length) return;
      lines.push(`#### ${heading}`);
      for (const f of fs) {
        const [first, ...rest] = f.detail.split("\n");
        lines.push(`- **${mdText(f.title, 200)}** (${mdCode(f.id, 80)}) \u2014 ${mdInline(first ?? "")}`);
        for (const extra of rest.slice(0, 20)) lines.push(`  - ${mdInline(extra)}`);
        if (rest.length > 20) lines.push(`  - \u2026and ${rest.length - 20} more`);
        lines.push(`  - Fix: ${mdInline(FLAG_FIXES[f.id])}`);
      }
      lines.push("");
    };
    section("fail", "Failing");
    section("warn", "Warnings");
  }
  const p = r.provenance;
  if (p.signals.length) {
    lines.push("<details><summary>Provenance signals</summary>", "");
    for (const s of p.signals.slice(0, 30)) lines.push(`- ${mdText(s.source, 40)}: ${mdText(s.detail)}`);
    if (p.humanCommits.length) lines.push(`- commits with no agent signal: ${joinCapped(p.humanCommits.map((s) => mdCode(s.slice(0, 7))), ", ")}`);
    lines.push("", "</details>", "");
  }
  if (r.checks.notes.length) {
    lines.push("<details><summary>Not readable with this token</summary>", "");
    for (const n of r.checks.notes.slice(0, 20)) lines.push(`- ${mdText(n)}`);
    lines.push("", "</details>", "");
  }
  if (r.policyWarnings.length) {
    lines.push("<details><summary>Policy warnings</summary>", "");
    for (const w of r.policyWarnings.slice(0, 50)) lines.push(`- ${mdText(w)}`);
    lines.push("", "</details>", "");
  }
  lines.push(`<sub>Evidence is for ${mdCode(r.pr.headSha, 80)} only and is re-evaluated on every push. Policy read from the base branch. [What is this?](${DOCS_URL})</sub>`);
  const out = lines.join("\n");
  return out.length > MAX_SUMMARY ? `${out.slice(0, MAX_SUMMARY - 40)}

\u2026(truncated)` : out;
}
function checkRunPayload(r) {
  const annotations = r.flags.flatMap(
    (f) => (f.locations ?? []).filter((l) => l.line !== void 0).map((l) => ({
      path: l.path,
      start_line: l.line,
      end_line: l.line,
      annotation_level: f.severity === "fail" ? "failure" : "warning",
      // Annotations are plain text on GitHub: no Markdown escaping, but controls dropped and capped.
      title: plainText(f.title, 255, true),
      message: plainText(l.message, 4e3)
    }))
  ).slice(0, 50);
  const pending = r.applies && r.conclusion === "pending";
  return {
    name: CHECK_NAME,
    head_sha: r.pr.headSha,
    status: pending ? "in_progress" : "completed",
    ...pending ? {} : { conclusion: r.conclusion === "pending" ? "neutral" : r.conclusion },
    output: { title: plainText(checkTitle(r), 255, true), summary: renderCard(r, { marker: false }), ...annotations.length ? { annotations } : {} }
  };
}

// src/github/publish.ts
function findSticky2(comments, author) {
  return findSticky(comments, COMMENT_MARKER, author);
}
async function publish(api, report, opts = {}) {
  const [owner, repo] = report.repo.split("/");
  const payload = checkRunPayload(report);
  const existing = (await api.listCheckRunsForRef(owner, repo, report.pr.headSha, CHECK_NAME)).find(
    (r) => r.name === CHECK_NAME && r.head_sha === report.pr.headSha
  );
  const { name: _n, head_sha: _h, ...update } = payload;
  const run2 = existing ? await api.updateCheckRun(owner, repo, existing.id, update) : await api.createCheckRun(owner, repo, payload);
  const checkRunUrl = run2.html_url ?? run2.details_url ?? void 0;
  const mode = opts.comment ?? "always";
  const comments = mode === "never" ? [] : await api.listIssueComments(owner, repo, report.pr.number);
  const author = mode === "never" ? "" : opts.commentAuthor?.trim() || await api.getAuthenticatedLogin?.() || DEFAULT_COMMENT_AUTHOR;
  const sticky = findSticky2(comments, author);
  const wantsComment = mode === "always" ? report.applies || !!sticky : mode === "on-flags" ? report.flags.length > 0 || !!sticky : false;
  if (!wantsComment) return { checkRunId: run2.id, checkRunUrl, commentAction: "skipped" };
  const body = renderCard(report, { checkUrl: checkRunUrl });
  if (sticky) {
    const c2 = await api.updateIssueComment(owner, repo, sticky.id, body);
    return { checkRunId: run2.id, checkRunUrl, commentId: c2.id, commentUrl: c2.html_url, commentAction: "updated" };
  }
  const c = await api.createIssueComment(owner, repo, report.pr.number, body);
  return { checkRunId: run2.id, checkRunUrl, commentId: c.id, commentUrl: c.html_url, commentAction: "created" };
}

// src/github/resolve.ts
var none = (err) => {
  if (err instanceof GitHubError && [403, 404, 422].includes(err.status)) return [];
  throw err;
};
var same = (a, b) => !!a && !!b && a.toLowerCase() === b.toLowerCase();
function pullMatches(p, repoFull, sha) {
  return (p.state === void 0 || p.state === "open") && p.head?.sha === sha && same(p.base?.repo?.full_name, repoFull);
}
function pick(cands, repoFull, sha) {
  const ok = cands.filter((p) => pullMatches(p, repoFull, sha));
  return ok.sort((a, b) => (b.updated_at ?? "").localeCompare(a.updated_at ?? "") || b.number - a.number)[0];
}
async function resolveWorkflowRunPr(api, owner, repo, run2) {
  const repoFull = `${owner}/${repo}`;
  const sha = run2.head_sha;
  if (!sha || !/^[0-9a-f]{40}$/i.test(sha)) return void 0;
  const fork = !!run2.head_repository?.full_name && !same(run2.head_repository.full_name, repoFull);
  for (const { number } of run2.pull_requests ?? []) {
    const p = await api.getPull(owner, repo, number);
    if (pullMatches(p, repoFull, sha)) return { number, pull: p, via: "event", fork };
    if (same(p.base?.repo?.full_name, repoFull) && p.state === "open" && p.head.sha !== sha)
      return {
        number,
        via: "event",
        fork,
        note: `PR #${number} has moved on to ${p.head.sha.slice(0, 7)}; this run was for ${sha.slice(0, 7)}. The run for the new head evaluates it.`
      };
  }
  const hit1 = pick(await api.listPullsForCommit(owner, repo, sha).catch(none), repoFull, sha);
  if (hit1) return { number: hit1.number, pull: hit1, via: "commit-pulls", fork };
  const headOwner = run2.head_repository?.owner?.login;
  if (headOwner && run2.head_branch) {
    const hit2 = pick(await api.listOpenPulls(owner, repo, { head: `${headOwner}:${run2.head_branch}`, max: 100 }).catch(none), repoFull, sha);
    if (hit2) return { number: hit2.number, pull: hit2, via: "head-filter", fork };
  }
  const hit3 = pick(await api.listOpenPulls(owner, repo, { max: 300 }).catch(none), repoFull, sha);
  if (hit3) return { number: hit3.number, pull: hit3, via: "open-scan", fork };
  return void 0;
}

// src/local.ts
var import_node_fs3 = require("node:fs");
var import_node_path2 = require("node:path");

// src/diff/git.ts
var import_node_child_process = require("node:child_process");
var GIT_AI_NOTES_REF = "refs/notes/ai";
function git(cwd, args, opts = {}) {
  try {
    return (0, import_node_child_process.execFileSync)("git", args, {
      cwd,
      encoding: "utf8",
      maxBuffer: 256 * 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0", LC_ALL: "C" }
    });
  } catch (err) {
    if (opts.allowFail) return "";
    const e = err;
    throw new Error(`git ${args.join(" ")} failed: ${String(e.stderr ?? e.message).trim()}`);
  }
}
function hasCommit(cwd, sha) {
  try {
    (0, import_node_child_process.execFileSync)("git", ["cat-file", "-e", `${sha}^{commit}`], { cwd, stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}
function diffFiles(cwd, base, head) {
  const out = git(cwd, ["diff", "-M", "--no-color", "--no-ext-diff", "--unified=3", `${base}...${head}`]);
  return parseGitDiff(out);
}
function readGitAiNotes(cwd, shas, opts = {}) {
  if (opts.fetch) git(cwd, ["fetch", "--quiet", "origin", `+${GIT_AI_NOTES_REF}:${GIT_AI_NOTES_REF}`], { allowFail: true });
  const notes = {};
  for (const sha of shas) {
    const n = git(cwd, ["notes", `--ref=${GIT_AI_NOTES_REF}`, "show", sha], { allowFail: true });
    if (n.trim()) notes[sha] = n;
  }
  return notes;
}

// src/local.ts
function loadCoverage(paths, cwd) {
  const reports = [];
  const missing = [];
  for (const p of paths) {
    const abs = (0, import_node_path2.resolve)(cwd, p);
    if (!(0, import_node_fs3.existsSync)(abs)) {
      missing.push(p);
      continue;
    }
    reports.push(parseCoverage((0, import_node_fs3.readFileSync)(abs, "utf8"), p));
  }
  return { report: mergeCoverage(reports), missing };
}
function enrichFromLocal(snap, cwd) {
  if (!(0, import_node_fs3.existsSync)((0, import_node_path2.resolve)(cwd, ".git")) && !git(cwd, ["rev-parse", "--git-dir"], { allowFail: true })) return { snap, used: false };
  if (!hasCommit(cwd, snap.pr.headSha) || !hasCommit(cwd, snap.pr.baseSha)) return { snap, used: false };
  const files = diffFiles(cwd, snap.pr.baseSha, snap.pr.headSha);
  const gitAiNotes = readGitAiNotes(
    cwd,
    snap.commits.map((c) => c.sha),
    { fetch: true }
  );
  return { snap: { ...snap, files, gitAiNotes: { ...snap.gitAiNotes, ...gitAiNotes } }, used: true };
}

// src/action.ts
function input(env, name, fallback = "") {
  return getInput(name, fallback, env);
}
function log(kind, msg) {
  if (kind === "info") console.log(msg);
  else console.log(`::${kind}::${escapeData(msg)}`);
}
function setOutput2(env, name, value) {
  setOutput(name, value, env);
}
function prNumberFromEvent(eventName, event) {
  const e = event;
  if (e.pull_request?.number) return e.pull_request.number;
  if (eventName === "workflow_run") return e.workflow_run?.pull_requests?.[0]?.number;
  if (eventName === "check_suite") return e.check_suite?.pull_requests?.[0]?.number;
  if (eventName === "check_run") return e.check_run?.pull_requests?.[0]?.number;
  if (e.issue?.pull_request && e.issue.number) return e.issue.number;
  return void 0;
}
async function run(deps) {
  const { env } = deps;
  const sleep = deps.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  const now = deps.now ?? Date.now;
  const repoFull = input(env, "repository", env.GITHUB_REPOSITORY ?? "");
  const token = input(env, "token", env.GITHUB_TOKEN ?? "");
  const api = deps.api ?? new RestClient(token, { baseUrl: env.GITHUB_API_URL });
  const eventName = env.GITHUB_EVENT_NAME ?? "";
  let event = {};
  try {
    if (env.GITHUB_EVENT_PATH) event = JSON.parse((0, import_node_fs4.readFileSync)(env.GITHUB_EVENT_PATH, "utf8"));
  } catch {
    log("warning", "Could not read the event payload");
  }
  const [owner, repo] = repoFull.split("/");
  let prNumber = Number(input(env, "pr-number")) || void 0;
  let pull;
  if (!prNumber && eventName === "workflow_run" && repoFull) {
    const found = await resolveWorkflowRunPr(api, owner, repo, event.workflow_run ?? {});
    if (found?.note) {
      log("notice", found.note);
      return { exitCode: 0 };
    }
    if (found) {
      prNumber = found.number;
      pull = found.pull;
      log("info", `workflow_run: PR #${found.number}${found.fork ? " (from a fork)" : ""}, found via ${found.via}.`);
    }
  } else if (!prNumber) prNumber = prNumberFromEvent(eventName, event);
  if (!repoFull || !prNumber) {
    log("notice", `No pull request for event "${eventName}"; nothing to evaluate.`);
    return { exitCode: 0 };
  }
  pull ??= await api.getPull(owner, repo, prNumber);
  const loaded = parsePolicy(await fetchPolicyText(api, owner, repo, pull.base.sha));
  const policy = loaded.policy;
  const workspace = input(env, "working-directory", env.GITHUB_WORKSPACE ?? process.cwd());
  let snap = await collectSnapshot(api, repoFull, prNumber, policy, { pull });
  const waitS = Number(input(env, "wait-for-checks", "0")) || 0;
  const pollS = Math.max(5, Number(input(env, "poll-interval", "20")) || 20);
  const deadline = now() + waitS * 1e3;
  while (waitS > 0) {
    const ce = evaluateChecks(snap, policy);
    if (ce.testsState !== "none" && !ce.pending) break;
    if (now() >= deadline) break;
    log("info", `Waiting for checks on ${snap.pr.headSha.slice(0, 7)} (tests: ${ce.testsState})\u2026`);
    await sleep(pollS * 1e3);
    snap = { ...snap, headChecks: await fetchChecks(api, owner, repo, snap.pr.headSha) };
  }
  const fromFork = !pull.head.repo?.full_name || pull.head.repo.full_name.toLowerCase() !== repoFull.toLowerCase();
  const coverageFiles = fromFork ? [] : [...policy.coverage.files, ...input(env, "coverage-files").split(/[\n,]/).map((s) => s.trim()).filter(Boolean)];
  if (fromFork) {
    snap = { ...snap, coverage: void 0, coverageUnavailable: FORK_COVERAGE_NOTE };
    log("info", `Fork PR: coverage ${FORK_COVERAGE_NOTE}; ignored.`);
  } else if (coverageFiles.length) {
    const { report: report2, missing } = loadCoverage(coverageFiles, workspace);
    if (missing.length) log("warning", `Coverage file(s) not found: ${missing.join(", ")}`);
    snap = { ...snap, coverage: report2 };
  }
  const localDiff = input(env, "local-diff", "auto");
  if (fromFork && localDiff !== "false") log("info", "Fork PR: diff from the API; the local checkout is not used for the diff or git-ai notes.");
  if (localDiff !== "false" && !fromFork) {
    const enriched = enrichFromLocal(snap, workspace);
    if (enriched.used) log("info", "Using the local checkout for the diff and git-ai notes.");
    snap = enriched.snap;
  }
  const report = evaluate(snap, policy, loaded.warnings);
  for (const w of loaded.warnings) log("warning", w);
  for (const f of report.flags) log(f.severity === "fail" ? "error" : "warning", `${f.title}: ${f.detail.split("\n")[0]}`);
  const comment = input(env, "comment", "always");
  let published = false;
  if (input(env, "dry-run", "false") !== "true") {
    try {
      const res = await publish(api, report, { comment, commentAuthor: input(env, "comment-author") || void 0 });
      published = true;
      setOutput2(env, "check-run-url", res.checkRunUrl ?? "");
      setOutput2(env, "comment-url", res.commentUrl ?? "");
    } catch (err) {
      if (err instanceof GitHubError && (err.status === 403 || err.status === 404)) {
        log(
          "warning",
          `Could not post the check run or comment (${err.message}). Needs checks: write and pull-requests: write; fork PRs on pull_request get a read-only token (run Evidence on workflow_run for them; see the README).`
        );
      } else throw err;
    }
  }
  setOutput2(env, "conclusion", report.conclusion);
  setOutput2(env, "is-agent", String(report.provenance.isAgent));
  setOutput2(env, "agents", report.provenance.agents.join(", "));
  setOutput2(env, "flags", report.flags.map((f) => f.id).join(","));
  if (env.RUNNER_TEMP) {
    const p = (0, import_node_path3.join)(env.RUNNER_TEMP, "mainfast-evidence.json");
    (0, import_node_fs4.writeFileSync)(p, JSON.stringify(report, (_k, v) => v instanceof Map ? Object.fromEntries(v) : v, 2));
    setOutput2(env, "report-path", p);
  }
  if (env.GITHUB_STEP_SUMMARY) (0, import_node_fs4.appendFileSync)(env.GITHUB_STEP_SUMMARY, `${renderCard(report, { marker: false })}
`);
  if (api instanceof RestClient) await planGate({ gh: api.gh, owner, repo, event, productName: PRODUCT_NAME, env });
  const failJob = input(env, "fail-job", "auto");
  const shouldFail = report.conclusion === "failure" && (failJob === "true" || failJob === "auto" && !published);
  return { report, exitCode: shouldFail ? 1 : 0 };
}
var isMain = typeof require !== "undefined" && require.main === module;
if (isMain) {
  run({ env: process.env }).then(
    ({ exitCode }) => process.exit(exitCode),
    (err) => {
      log("error", err instanceof Error ? err.stack ?? err.message : String(err));
      process.exit(1);
    }
  );
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  input,
  prNumberFromEvent,
  run
});
