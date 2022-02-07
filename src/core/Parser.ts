"use strict";
import {
  BODY_MODE,
  CODE,
  STATE,
  peek,
  isWhitespaceCode,
  htmlTags,
  Notifications,
  Pos,
  ExpressionPos,
  TemplatePos,
} from "../internal";

export interface PartMeta {
  parentState: StateDefinition;
}
export interface Part extends PartMeta, Pos {}
export interface ExpressionPart extends PartMeta, ExpressionPos {}
export interface TemplatePart extends PartMeta, TemplatePos {}

export interface StateDefinition<P extends Part = Part> {
  name: string;
  eol?: (this: Parser, str: string, activePart: P) => void;
  eof?: (this: Parser, activePart: P) => void;
  enter?: (
    this: Parser,
    activePart: P,
    parentState: StateDefinition | undefined
  ) => void;
  exit?: (this: Parser, activePart: P) => void;
  return?: (
    this: Parser,
    childState: StateDefinition,
    childPart: Part,
    activePart: P
  ) => void;
  char?: (this: Parser, char: string, code: number, activePart: P) => void;
}

export class Parser {
  public pos!: number;
  public maxPos!: number;
  public data!: string;
  public filename!: string;
  public state!: StateDefinition;
  public parts!: Part[]; // Used to keep track of parts such as CDATA, expressions, declarations, etc.
  public activePart!: Part; // The current part at the top of the part stack
  public currentOpenTag: STATE.OpenTagPart | undefined; // Used to reference the current open tag that is being parsed
  public currentAttribute: STATE.AttrPart | undefined; // Used to reference the current attribute that is being parsed
  public withinAttrGroup!: boolean; // Set to true if the parser is within a concise mode attribute group
  public indent!: string; // Used to build the indent for the current concise line
  public isConcise!: boolean; // Set to true if parser is currently in concise mode
  public isWithinSingleLineHtmlBlock!: boolean; // Set to true if the current block is for a single line HTML block
  public isWithinRegExpCharset!: boolean; // Set to true if the current regexp entered a charset.
  public htmlBlockDelimiter?: string; // Current delimiter for multiline HTML blocks nested within a concise tag. e.g. "--"
  public htmlBlockIndent?: string; // Used to hold the indentation for a delimited, multiline HTML block
  public beginMixedMode?: boolean; // Used as a flag to mark that the next HTML block should enter the parser into HTML mode
  public endingMixedModeAtEOL?: boolean; // Used as a flag to record that the next EOL to exit HTML mode and go back to concise
  public textPos!: number; // Used to buffer text that is found within the body of a tag
  public text!: string; // Used to buffer text that is found within the body of a tag
  public textParseMode!: "html" | "cdata" | "parsed-text" | "static-text";
  public notifications: Notifications[] | undefined;
  public done!: boolean;
  public blockStack!: ((
    | STATE.OpenTagPart
    | {
        type: "html";
        delimiter?: string;
        indent: string;
      }
  ) & { body?: BODY_MODE; nestedIndent?: string })[]; // Used to keep track of HTML tags and HTML blocks

  constructor(data: string, filename: string) {
    this.data = data;
    this.filename = filename;
    this.pos = data.charCodeAt(0) === 0xfeff ? 1 : 0; // https://en.wikipedia.org/wiki/Byte_order_mark
    this.maxPos = data.length;
    this.activePart = { pos: this.pos, endPos: this.pos } as Part;
    this.parts = [this.activePart];
    this.textPos = -1;
    this.textParseMode = "html";
    this.done = false;
    this.notifications = undefined;
    this.currentOpenTag = undefined;
    this.currentAttribute = undefined;
    this.blockStack = [];
    this.indent = "";
    this.isConcise = true;
    this.withinAttrGroup = false;
    this.isWithinRegExpCharset = false;
    this.isWithinSingleLineHtmlBlock = false;
    this.htmlBlockDelimiter = undefined;
    this.htmlBlockIndent = undefined;
    this.beginMixedMode = false;
    this.endingMixedModeAtEOL = false;
    this.state = STATE.CONCISE_HTML_CONTENT;

    STATE.CONCISE_HTML_CONTENT.enter!.call(this, this.activePart, undefined);
  }

  read(node: Pos) {
    return this.substring(node.pos, node.endPos);
  }

  enterState<P extends Part = Part>(
    state: StateDefinition<P>,
    part: Partial<P> = {}
  ) {
    // if (this.state === state) {
    //   // Re-entering the same state can lead to unexpected behavior
    //   // so we should throw error to catch these types of mistakes
    //   throw new Error(
    //     "Re-entering the current state is illegal - " + state.name
    //   );
    // }

    const parentState = this.state;
    const activePart = (this.activePart = part as unknown as P);
    this.state = state as StateDefinition;
    this.parts.push(activePart);
    part.pos = this.pos + 1;
    part.parentState = parentState;
    state.enter?.call(this, activePart, parentState);

    return this.activePart;
  }

  exitState(includedEndChars?: string) {
    if (includedEndChars) {
      for (let i = 0; i < includedEndChars.length; i++) {
        if (this.data[this.pos + i] !== includedEndChars[i]) {
          if (this.pos + i >= this.maxPos) {
            this.notifyError(
              this.activePart,
              "UNEXPECTED_EOF",
              "EOF reached with current part incomplete"
            );
          } else {
            throw new Error(
              "Unexpected end character at position " + (this.pos + i)
            );
          }
        }
      }
      this.skip(includedEndChars.length);
    }

    const childPart = this.parts.pop()!;
    const childState = this.state;
    const parentState = (this.state = childPart.parentState);
    const parentPart = (this.activePart = peek(this.parts)!);

    childPart.endPos = this.pos;
    childState.exit?.call(this, childPart);

    if (parentState.return) {
      parentState.return.call(this, childState, childPart, parentPart);
    }
  }

  get value() {
    const { notifications } = this;
    if (notifications) {
      if (notifications.length === 2) {
        this.notifications = undefined;
        return notifications as unknown as Notifications;
      } else {
        return notifications.splice(0, 2) as unknown as Notifications;
      }
    }
  }

  notify<T extends Notifications[0]>(
    type: T,
    data: Extract<Notifications, [T, any]>[1]
  ) {
    if (this.notifications) {
      this.notifications.push(type as any, data);
    } else {
      this.notifications = [type, data] as any;
    }
  }

  /**
   * Look ahead to see if the given str matches the substring sequence
   * beyond
   */
  lookAheadFor(str: string, startPos = this.pos + 1) {
    // Have we read enough chunks to read the string that we need?
    const len = str.length;
    const endPos = startPos + len;

    if (endPos < this.maxPos) {
      const { data } = this;
      for (let i = 0; i < len; i++) {
        if (str[i] !== data[startPos + i]) {
          return undefined;
        }
      }

      return str;
    }
  }

  /**
   * Look ahead to a character at a specific offset.
   * The callback will be invoked with the character
   * at the given position.
   */
  lookAtCharAhead(offset: number, startPos = this.pos) {
    return this.data.charAt(startPos + offset);
  }

  lookAtCharCodeAhead(offset: number, startPos = this.pos) {
    return this.data.charCodeAt(startPos + offset);
  }

  rewind(offset: number) {
    return (this.pos -= offset);
  }

  skip(offset: number) {
    return (this.pos += offset);
  }

  end() {
    this.pos = this.maxPos + 1;
  }

  substring(pos: number, endPos?: number) {
    return this.data.substring(pos, endPos);
  }

  /**
   * This is called to determine if a tag is an "open only tag". Open only tags such as <img>
   * are immediately closed.
   */
  isOpenTagOnly(tagName: string) {
    return tagName ? htmlTags.isOpenTagOnly(tagName.toLowerCase()) : false;
  }

  startText(offset = 0) {
    if (this.textPos === -1) {
      this.textPos = this.pos + offset;
    }
  }

  /**
   * Clear out any buffered body text and this.notifiers.notify any listeners
   */
  endText() {
    if (this.textPos !== -1) {
      if (this.textPos < this.pos) {
        this.notify("text", {
          pos: this.textPos,
          endPos: this.pos,
        });
      }

      this.textPos = -1;
    }
  }

  /**
   * This is used to enter into "HTML" parsing mode instead
   * of concise HTML. We push a block on to the stack so that we know when
   * return back to the previous parsing mode and to ensure that all
   * tags within a block are properly closed.
   */
  beginHtmlBlock(delimiter?: string) {
    this.htmlBlockIndent = this.indent;
    this.htmlBlockDelimiter = delimiter;

    const parent = peek(this.blockStack);
    this.blockStack.push({
      type: "html",
      delimiter,
      indent: this.indent,
    });

    if (parent && parent.body) {
      if (parent.body === BODY_MODE.PARSED_TEXT) {
        this.enterState(STATE.PARSED_TEXT_CONTENT);
      } else if (parent.body === BODY_MODE.STATIC_TEXT) {
        this.enterState(STATE.STATIC_TEXT_CONTENT);
      } else {
        throw new Error("Illegal value for parent.body: " + parent.body);
      }
    } else {
      return this.enterState(STATE.HTML_CONTENT);
    }
  }

  /**
   * This method gets called when we are in non-concise mode
   * and we are exiting out of non-concise mode.
   */
  endHtmlBlock() {
    // End any text
    this.endText();

    // Make sure all tags in this HTML block are closed
    for (let i = this.blockStack.length - 1; i >= 0; i--) {
      const curBlock = this.blockStack[i];
      if (curBlock.type === "html") {
        // Remove the HTML block from the stack since it has ended
        this.blockStack.pop();
        // We have reached the point where the HTML block started
        // so we can stop
        break;
      } else {
        // The current block is for an HTML tag and it still open. When a tag is tag is closed
        // it is removed from the stack
        this.notifyError(
          curBlock,
          "MISSING_END_TAG",
          'Missing ending "' + this.read(curBlock.tagName) + '" tag'
        );
        return;
      }
    }

    // Resert variables associated with parsing an HTML block
    this.htmlBlockIndent = undefined;
    this.htmlBlockDelimiter = undefined;
    this.isWithinSingleLineHtmlBlock = false;

    if (this.state !== STATE.CONCISE_HTML_CONTENT) {
      this.enterState(STATE.CONCISE_HTML_CONTENT);
    }
  }

  /**
   * This gets called when we reach EOF outside of a tag.
   */
  htmlEOF() {
    this.endText();

    while (this.blockStack.length) {
      const curBlock = peek(this.blockStack)!;
      if (curBlock.type === "tag") {
        if (curBlock.concise) {
          this.closeTag();
        } else {
          // We found an unclosed tag on the stack that is not for a concise tag. That means
          // there is a problem with the template because all open tags should have a closing
          // tag
          //
          // NOTE: We have already closed tags that are open tag only or self-closed
          this.notifyError(
            curBlock,
            "MISSING_END_TAG",
            'Missing ending "' + this.read(curBlock.tagName) + '" tag'
          );
          return;
        }
      } else if (curBlock.type === "html") {
        // We reached the end of file while still within a single line HTML block. That's okay
        // though since we know the line is completely. We'll continue ending all open concise tags.
        this.blockStack.pop();
      } else {
        // There is a bug in our this...
        throw new Error(
          "Illegal state. There should not be any non-concise tags on the stack when in concise mode"
        );
      }
    }
  }

  notifyError(pos: number | Pos, code: string, message: string) {
    if (typeof pos === "number") {
      this.notify("error", {
        code,
        message,
        pos,
        endPos: -1,
      });
    } else {
      this.notify("error", {
        code,
        message,
        pos: pos.pos,
        endPos: pos.endPos,
      });
    }
    
    this.end();
  }

  closeTag(closeTag?: Pos) {
    const lastTag = this.blockStack.pop();

    if (!lastTag || lastTag.type !== "tag") {
      return this.notifyError(
        closeTag!,
        "EXTRA_CLOSING_TAG",
        'The closing "' +
          this.read(closeTag!) +
          '" tag was not expected'
      );
    }

    if (closeTag) {
      const closeTagNameStart = closeTag.pos + 2; // strip </
      const closeTagNameEnd = closeTag.endPos - 1; // strip >

      if (closeTagNameStart < closeTagNameEnd!) {
        // TODO: instead of substringing the tagName, we should string compare two ranges in the source text.
        const expectedCloseTagName = this.read(lastTag.tagName);
        const closeTagName = this.substring(closeTagNameStart, closeTagNameEnd);

        if (closeTagName !== (expectedCloseTagName || "div")) {
          const lastTagName = lastTag.tagName;
          // TODO: refactor this entire thing.
          const shorthandEndPos = Math.max(
            lastTagName.shorthandId ? lastTagName.shorthandId.endPos : 0,
            lastTagName.shorthandClassNames
              ? lastTagName.shorthandClassNames[
                  lastTagName.shorthandClassNames.length - 1
                ].endPos
              : 0
          );

          if (
            !shorthandEndPos ||
            // accepts including the tag class/id shorthands as part of the close tag name.
            closeTagName !== this.substring(lastTagName.pos, shorthandEndPos)
          ) {
            return this.notifyError(
              closeTag,
              "MISMATCHED_CLOSING_TAG",
              'The closing "' +
                this.read(closeTag) +
                '" tag does not match the corresponding opening "' +
                (expectedCloseTagName || "div") +
                '" tag'
            );
          }
        }
      }

      this.notify("closeTag", {
        pos: closeTag.pos,
        endPos: closeTag.endPos,
        value: {
          pos: closeTagNameStart,
          endPos: closeTagNameEnd,
        },
      });
    } else if (this.isConcise) {
      this.notify("closeTag", {
        pos: this.pos,
        endPos: this.pos,
        value: undefined,
      });
    }

    if (lastTag.beginMixedMode) {
      this.endingMixedModeAtEOL = true;
    }
  }

  lookPastWhitespaceFor(str: string, start = 1) {
    let ahead = start;
    while (isWhitespaceCode(this.lookAtCharCodeAhead(ahead))) ahead++;
    return !!this.lookAheadFor(str, this.pos + ahead);
  }

  getPreviousNonWhitespaceChar(start = -1) {
    let behind = start;
    while (isWhitespaceCode(this.lookAtCharCodeAhead(behind))) behind--;
    return this.lookAtCharAhead(behind);
  }

  onlyWhitespaceRemainsOnLine(offset = 1) {
    for (let i = this.pos + offset; i < this.maxPos; i++) {
      const code = this.data.charCodeAt(i);
      if (code === CODE.NEWLINE) return true;
      if (!isWhitespaceCode(code)) break;
    }

    return false;
  }

  consumeWhitespace() {
    let ahead = 0;
    let whitespace = "";
    while (isWhitespaceCode(this.lookAtCharCodeAhead(ahead))) {
      whitespace += this.lookAtCharAhead(ahead++);
    }
    this.skip(whitespace.length);
    return whitespace;
  }

  handleDelimitedBlockEOL(newLine: string) {
    // If we are within a delimited HTML block then we want to check if the next line is the end
    // delimiter. Since we are currently positioned at the start of the new line character our lookahead
    // will need to include the new line character, followed by the expected indentation, followed by
    // the delimiter.
    const endHtmlBlockLookahead =
      this.htmlBlockIndent! + this.htmlBlockDelimiter;

    if (this.lookAheadFor(endHtmlBlockLookahead, this.pos + newLine.length)) {
      this.skip(this.htmlBlockIndent!.length);
      this.skip(this.htmlBlockDelimiter!.length);

      this.enterState(STATE.CONCISE_HTML_CONTENT);
      this.enterState(STATE.CHECK_TRAILING_WHITESPACE, {
        handler(err, eof) {
          if (err) {
            // This is a non-whitespace! We don't allow non-whitespace
            // after matching two or more hyphens. This is user error...
            this.notifyError(
              this.pos,
              "INVALID_CHARACTER",
              'A non-whitespace of "' +
                err.ch +
                '" was found on the same line as the ending delimiter ("' +
                this.htmlBlockDelimiter +
                '") for a multiline HTML block'
            );
            return;
          }

          this.endHtmlBlock();

          if (eof) {
            this.htmlEOF();
          }
        },
      });
      return;
    } else if (
      this.lookAheadFor(this.htmlBlockIndent!, this.pos + newLine.length)
    ) {
      // We know the next line does not end the multiline HTML block, but we need to check if there
      // is any indentation that we need to skip over as we continue parsing the HTML in this
      // multiline HTML block

      this.skip(this.htmlBlockIndent!.length);
      // We stay in the same state since we are still parsing a multiline, delimited HTML block
    } else if (this.htmlBlockIndent && !this.onlyWhitespaceRemainsOnLine()) {
      // the next line does not have enough indentation
      // so unless it is blank (whitespace only),
      // we will end the block
      this.endHtmlBlock();
    }
  }

  enterParsedTextContentState() {
    const last =
      this.blockStack.length && this.blockStack[this.blockStack.length - 1];

    // TODO: is the last condition necessary.
    if (!last || last.type === "html" || last.tagName.pos === last.tagName.endPos) {
      throw new Error(
        'The "parsed text content" parser state is only allowed within a tag'
      );
    }

    if (this.isConcise) {
      // We will transition into the STATE.PARSED_TEXT_CONTENT state
      // for each of the nested HTML blocks
      last.body = BODY_MODE.PARSED_TEXT;
      this.enterState(STATE.CONCISE_HTML_CONTENT);
    } else {
      this.enterState(STATE.PARSED_TEXT_CONTENT);
    }
  }

  enterJsContentState() {
    this.enterParsedTextContentState();
  }

  enterCssContentState() {
    this.enterParsedTextContentState();
  }

  enterStaticTextContentState() {
    const last =
      this.blockStack.length && this.blockStack[this.blockStack.length - 1];

    if (!last || last.type === "html" || !last.tagName.value) {
      throw new Error(
        'The "static text content" parser state is only allowed within a tag'
      );
    }

    if (this.isConcise) {
      // We will transition into the STATE.STATIC_TEXT_CONTENT state
      // for each of the nested HTML blocks
      last.body = BODY_MODE.STATIC_TEXT;
      this.enterState(STATE.CONCISE_HTML_CONTENT);
    } else {
      this.enterState(STATE.STATIC_TEXT_CONTENT);
    }
  }

  next() {
    if (this.notifications) return this;

    while (this.pos < this.maxPos) {
      const ch = this.data.charAt(this.pos);
      const code = this.data.charCodeAt(this.pos);

      if (code === CODE.NEWLINE) {
        if (this.lookAtCharCodeAhead(-1) === CODE.CARRIAGE_RETURN) {
          this.state.eol?.call(this, "\r\n", this.activePart);
          this.pos += 2;
        } else {
          this.state.eol?.call(this, ch, this.activePart);
          this.pos++;
        }
      } else {
        this.state.char!.call(this, ch, code, this.activePart);
        this.pos++;
      }

      if (this.notifications) return this;
    }

    const { eof } = this.state;
    if (eof) {
      eof.call(this, this.activePart);
      if (this.notifications) return this;
    }

    this.done = true;
    return this;
  }

  [Symbol.iterator]() {
    return this;
  }
}
