import fs from "fs";
import TreeBuilder from "./TreeBuilder";
import { createParser } from "../../src";
import {
  AttrNamePos,
  AttrValuePos,
  ExpressionPos,
  Pos,
  TagEndPos,
  TemplatePos,
} from "../../src/internal";

export default function runTest() {
  return function ({ test, resolve, snapshot }) {
    test(function () {
      const inputPath = resolve("input.htmljs");
      const testOptionsPath = resolve("test.js");
      const main = fs.existsSync(testOptionsPath) && require(testOptionsPath);

      snapshot(
        parse(
          main?.getSource?.() ??
            fs.readFileSync(inputPath, "utf8").replace(/\r\n|\n/g, "\n"),
          inputPath
        )
      );
    });
  };
}

function parse(text, inputPath) {
  const parser = createParser(text, inputPath);
  const builder = new TreeBuilder(text);
  let curTagName: TemplatePos;
  let curShorthandId: TemplatePos;
  let curShorthandClassNames: TemplatePos[];
  let curTagVar: ExpressionPos;
  let curTagArgs: ExpressionPos;
  let curTagParams: ExpressionPos;
  let curAttrs: (
    | Partial<{ name: AttrNamePos } & AttrValuePos>
    | ExpressionPos
  )[];

  for (const [type, data] of parser) {
    console.log(type, data);
    switch (type) {
      case "error":
        builder.listeners.onError({
          type,
          ...data,
        });
        break;
      case "text":
        builder.listeners.onText({
          type,
          ...data,
          value: parser.read(data),
        });
        break;
      case "cdata":
        builder.listeners.onCDATA({
          type,
          ...data,
          value: parser.read((data as ExpressionPos).value),
        });
        break;
      case "doctype":
        builder.listeners.onDocumentType({
          type: "documentType",
          ...data,
          value: parser.read((data as ExpressionPos).value),
        });
        break;

      case "declaration":
        builder.listeners.onDeclaration({
          type,
          ...data,
          value: parser.read((data as ExpressionPos).value),
        });
        break;
      case "comment":
        builder.listeners.onComment({
          type,
          ...data,
          value: parser.read((data as ExpressionPos).value),
        });
        break;
      case "placeholder":
        builder.listeners.onPlaceholder({
          type,
          ...data,
          value: parser.read((data as ExpressionPos).value),
        });
        break;
      case "tagName": {
        curTagName = data as TemplatePos;
        builder.listeners.onOpenTagName({
          type: "openTagName",
          tagName: {
            value: parser.read(curTagName),
            expression:
              curTagName.expressions.length === 1 &&
              curTagName.quasis[0].pos === curTagName.quasis[0].endPos &&
              curTagName.quasis[1].pos === curTagName.quasis[1].endPos
                ? {
                    value: parser.read(curTagName.expressions[0].value),
                  }
                : undefined,
          },
          pos: curTagName.pos,
          endPos: curTagName.endPos,
          concise: false, // TODO
          shorthandId: curShorthandId && {
            ...curShorthandId,
            value: parser.read(curShorthandId).slice(1),
          },
          shorthandClassNames:
            curShorthandClassNames &&
            curShorthandClassNames.map((shorthandClassName) => ({
              ...shorthandClassName,
              value: parser.read(shorthandClassName).slice(1),
            })),
        });
        break;
      }
      case "tagShorthandId":
        curShorthandId = data as TemplatePos;
        break;
      case "tagShorthandClass":
        curShorthandClassNames ??= [];
        curShorthandClassNames.push(data as TemplatePos);
        break;
      case "tagVar":
        curTagVar = data as ExpressionPos;
        break;
      case "tagArgs":
        curTagArgs = data as ExpressionPos;
        break;
      case "tagParams":
        curTagParams = data as ExpressionPos;
        break;
      case "attrName":
        curAttrs ??= [];
        curAttrs.push({ name: data as AttrNamePos });
        break;
      case "attrValue":
        Object.assign(curAttrs[curAttrs.length - 1], data);
        break;
      case "spreadAttr":
        curAttrs ??= [];
        curAttrs.push(data);
        break;
      case "tagEnd":
        builder.listeners.onOpenTag({
          type: "openTag",
          tagName: {
            value: parser.read(curTagName),
            expression:
              curTagName.expressions.length === 1 &&
              curTagName.quasis[0].pos === curTagName.quasis[0].endPos &&
              curTagName.quasis[1].pos === curTagName.quasis[1].endPos
                ? {
                    value: parser.read(curTagName.expressions[0].value),
                  }
                : undefined,
          },
          var: curTagVar && {
            ...curTagVar,
            value: parser.read(curTagVar.value),
          },
          argument: curTagArgs && {
            ...curTagArgs,
            value: parser.read(curTagArgs.value),
          },
          params: curTagParams && {
            ...curTagParams,
            value: parser.read(curTagParams.value),
          },
          pos: curTagName.pos,
          endPos: data.endPos,
          tagNameEndPos: curTagName.endPos,
          selfClosed: (data as TagEndPos).selfClosed,
          openTagOnly: (data as TagEndPos).openTagOnly,
          attributes: (
            (curAttrs || []) as ({ name: AttrNamePos } & AttrValuePos)[]
          ).map((attr) => ({
            default: attr.name.default,
            name: {
              ...attr.name,
              value: parser.read(attr.name),
            },
            pos: attr.pos,
            endPos: attr.endPos,
            value: attr.value && {
              ...attr.value,
              value: parser.read(attr.value),
            },
            bound: attr.bound,
            method: attr.method,
            spread: attr.name === undefined,
            argument: attr.argument && {
              ...attr.argument,
              value: parser.read(attr.argument.value),
            },
          })),
          concise: false, // TODO
          shorthandId: curShorthandId && {
            ...curShorthandId,
            value: parser.read(curShorthandId).slice(1),
          },
          shorthandClassNames:
            curShorthandClassNames &&
            curShorthandClassNames.map((shorthandClassName) => ({
              ...shorthandClassName,
              value: parser.read(shorthandClassName).slice(1),
            })),
        });

        if ((data as TagEndPos).openTagOnly || (data as TagEndPos).selfClosed) {
          builder.listeners.onCloseTag({
            type,
            ...data,
          });
        }

        curTagName = undefined;
        curShorthandId = undefined;
        curShorthandClassNames = undefined;
        curTagVar = undefined;
        curTagArgs = undefined;
        curTagParams = undefined;
        curAttrs = undefined;
        break;
      case "closeTag":
        builder.listeners.onCloseTag({
          type,
          ...data,
          tagName:
            (data as ExpressionPos).value &&
            parser.read((data as ExpressionPos).value),
        });
        break;
    }
  }

  return builder.toString();

  // return treeBuilder.toString();
}
