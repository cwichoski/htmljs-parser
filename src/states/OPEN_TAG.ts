import {
  CODE,
  STATE,
  isWhitespaceCode,
  StateDefinition,
  Part,
} from "../internal";

const enum TAG_STATE {
  VAR,
  ARGUMENT,
  PARAMS,
}

export interface OpenTagPart extends Part {
  type: "tag";
  state: TAG_STATE | undefined;
  concise: boolean;
  beginMixedMode?: boolean;
  tagName: STATE.TagNamePart;
  selfClosed: boolean;
  openTagOnly: boolean;
  hasAttributes: boolean;
  hasArgument: boolean;
  indent: string;
  nestedIndent?: string;
}

export const OPEN_TAG: StateDefinition<OpenTagPart> = {
  name: "OPEN_TAG",

  enter(tag) {
    this.endText();

    tag.type = "tag";
    tag.state = undefined;
    tag.hasAttributes = false;
    tag.hasArgument = false;
    tag.indent = this.indent;
    tag.concise = this.isConcise;
    tag.beginMixedMode = this.beginMixedMode || this.endingMixedModeAtEOL;
    tag.selfClosed = false;
    tag.openTagOnly = false;

    this.beginMixedMode = false;
    this.endingMixedModeAtEOL = false;
    this.currentOpenTag = tag;
    this.blockStack.push(tag);
  },

  exit(tag) {
    const tagName = tag.tagName;
    const selfClosed = tag.selfClosed;
    const literalTagNamePos =
      tagName.quasis.length === 1 ? tagName.quasis[0] : undefined;
    const literalTagName = literalTagNamePos && this.read(literalTagNamePos); // TODO: avoid read
    const openTagOnly = (tag.openTagOnly = literalTagName
      ? this.isOpenTagOnly(literalTagName)
      : false);
    const origState = this.state;

    this.notify("tagEnd", {
      pos: this.pos - (this.isConcise ? 0 : selfClosed ? 2 : 1),
      endPos: this.pos,
      openTagOnly,
      selfClosed,
    });

    if (!this.isConcise && (selfClosed || openTagOnly)) {
      this.closeTag();
      this.enterState(STATE.HTML_CONTENT);
    } else if (this.state === origState) {
      // The listener didn't transition the parser to a new state
      // so we use some simple rules to find the appropriate state.
      if (literalTagName === "script") {
        this.enterJsContentState();
      } else if (literalTagName === "style") {
        this.enterCssContentState();
      } else if (this.isConcise) {
        this.enterState(STATE.CONCISE_HTML_CONTENT);
      } else {
        this.enterState(STATE.HTML_CONTENT);
      }
    }

    // We need to record the "expected close tag name" if we transition into
    // either STATE.STATIC_TEXT_CONTENT or STATE.PARSED_TEXT_CONTENT
    this.currentOpenTag = undefined;
  },

  return(childState, childPart, tag) {
    switch (childState) {
      case STATE.TAG_NAME: {
        tag.tagName = childPart as STATE.TagNamePart;
        break;
      }
      case STATE.ATTRIBUTE: {
        tag.hasAttributes = true;
        break;
      }
      case STATE.EXPRESSION: {
        switch (tag.state) {
          case TAG_STATE.VAR: {
            if (childPart.pos === childPart.endPos) {
              return this.notifyError(
                this.pos,
                "MISSING_TAG_VARIABLE",
                "A slash was found that was not followed by a variable name or lhs expression"
              );
            }

            this.notify("tagVar", {
              pos: childPart.pos - 1, // include /,
              endPos: childPart.endPos,
              value: {
                pos: childPart.pos,
                endPos: childPart.endPos,
              },
            });
            break;
          }
          case TAG_STATE.ARGUMENT: {
            this.skip(1); // skip closing )

            if (this.lookPastWhitespaceFor("{")) {
              this.consumeWhitespace();
              this.enterState(STATE.ATTRIBUTE, {
                argument: childPart,
              });
            } else {
              tag.hasArgument = true;
              this.notify("tagArgs", {
                pos: childPart.pos - 1, // include (
                endPos: childPart.endPos + 1, // include )
                value: {
                  pos: childPart.pos,
                  endPos: childPart.endPos,
                },
              });
            }
            break;
          }
          case TAG_STATE.PARAMS: {
            this.skip(1); // skip closing |
            this.notify("tagParams", {
              pos: childPart.pos - 1, // include leading |
              endPos: childPart.endPos + 1, // include closing |
              value: {
                pos: childPart.pos,
                endPos: childPart.endPos,
              },
            });
            break;
          }
        }
        break;
      }
    }
  },

  eol(newline) {
    if (this.isConcise && !this.withinAttrGroup) {
      // In concise mode we always end the open tag
      this.exitState();
      this.skip(newline.length);
    }
  },

  eof(tag) {
    if (this.isConcise) {
      if (this.withinAttrGroup) {
        this.notifyError(
          tag,
          "MALFORMED_OPEN_TAG",
          'EOF reached while within an attribute group (e.g. "[ ... ]").'
        );
        return;
      }

      // If we reach EOF inside an open tag when in concise-mode
      // then we just end the tag and all other open tags on the stack
      this.exitState();
    } else {
      // Otherwise, in non-concise mode we consider this malformed input
      // since the end '>' was not found.
      this.notifyError(
        tag,
        "MALFORMED_OPEN_TAG",
        "EOF reached while parsing open tag"
      );
    }
  },

  char(_, code, tag) {
    if (this.isConcise) {
      if (code === CODE.SEMICOLON) {
        this.exitState(";");
        this.enterState(STATE.CHECK_TRAILING_WHITESPACE, {
          handler(err) {
            if (err) {
              const code = err.ch.charCodeAt(0);

              if (code === CODE.FORWARD_SLASH) {
                if (this.lookAheadFor("/")) {
                  this.enterState(STATE.JS_COMMENT_LINE);
                  return;
                } else if (this.lookAheadFor("*")) {
                  this.enterState(STATE.JS_COMMENT_BLOCK);
                  return;
                }
              } else if (
                code === CODE.OPEN_ANGLE_BRACKET &&
                this.lookAheadFor("!--")
              ) {
                // html comment
                this.enterState(STATE.HTML_COMMENT);
                return;
              }

              this.notifyError(
                this.pos,
                "INVALID_CODE_AFTER_SEMICOLON",
                "A semicolon indicates the end of a line.  Only comments may follow it."
              );
            }
          },
        });
        return;
      }

      if (code === CODE.HTML_BLOCK_DELIMITER) {
        if (this.lookAtCharCodeAhead(1) !== CODE.HTML_BLOCK_DELIMITER) {
          this.notifyError(
            tag,
            "MALFORMED_OPEN_TAG",
            '"-" not allowed as first character of attribute name'
          );
          return;
        }

        if (this.withinAttrGroup) {
          this.notifyError(
            this.pos,
            "MALFORMED_OPEN_TAG",
            "Attribute group was not properly ended"
          );
          return;
        }

        // The open tag is complete
        this.exitState();

        this.htmlBlockDelimiter = "";
        const indentMatch = /[^\n]*\n(\s+)/.exec(this.substring(this.pos));
        if (indentMatch) {
          const whitespace = indentMatch[1].split(/\n/g);
          const nextIndent = whitespace[whitespace.length - 1];
          if (nextIndent > this.indent) {
            this.indent = nextIndent;
          }
        }

        this.enterState(STATE.BEGIN_DELIMITED_HTML_BLOCK);
        return;
      } else if (code === CODE.OPEN_SQUARE_BRACKET) {
        if (this.withinAttrGroup) {
          this.notifyError(
            this.pos,
            "MALFORMED_OPEN_TAG",
            'Unexpected "[" character within open tag.'
          );
          return;
        }

        this.withinAttrGroup = true;
        return;
      } else if (code === CODE.CLOSE_SQUARE_BRACKET) {
        if (!this.withinAttrGroup) {
          this.notifyError(
            this.pos,
            "MALFORMED_OPEN_TAG",
            'Unexpected "]" character within open tag.'
          );
          return;
        }

        this.withinAttrGroup = false;
        return;
      }
    } else {
      if (code === CODE.CLOSE_ANGLE_BRACKET) {
        this.exitState(">");
        return;
      } else if (code === CODE.FORWARD_SLASH) {
        if (this.lookAtCharCodeAhead(1) === CODE.CLOSE_ANGLE_BRACKET) {
          tag.selfClosed = true;
          this.exitState("/>");
          return;
        }
      }
    }

    if (code === CODE.OPEN_ANGLE_BRACKET) {
      return this.notifyError(
        this.pos,
        "ILLEGAL_ATTRIBUTE_NAME",
        'Invalid attribute name. Attribute name cannot begin with the "<" character.'
      );
    }

    if (
      code === CODE.FORWARD_SLASH &&
      this.lookAtCharCodeAhead(1) === CODE.ASTERISK
    ) {
      // Skip over code inside a JavaScript block comment
      this.enterState(STATE.JS_COMMENT_BLOCK);
      return;
    }

    if (isWhitespaceCode(code)) {
      // ignore whitespace within element...
    } else if (code === CODE.COMMA) {
      this.consumeWhitespace();
    } else if (code === CODE.FORWARD_SLASH && !tag.hasAttributes) {
      tag.state = TAG_STATE.VAR;
      this.enterState(STATE.EXPRESSION, {
        terminatedByWhitespace: true,
        terminator: this.isConcise
          ? [";", "(", "|", "=", ":="]
          : [">", "/>", "(", "|", "=", ":="],
      });
    } else if (code === CODE.OPEN_PAREN && !tag.hasAttributes) {
      if (tag.hasArgument) {
        this.notifyError(
          this.pos,
          "ILLEGAL_TAG_ARGUMENT",
          "A tag can only have one argument"
        );
        return;
      }
      tag.state = TAG_STATE.ARGUMENT;
      this.enterState(STATE.EXPRESSION, {
        skipOperators: true,
        terminator: ")",
      });
    } else if (code === CODE.PIPE && !tag.hasAttributes) {
      tag.state = TAG_STATE.PARAMS;
      this.enterState(STATE.EXPRESSION, {
        skipOperators: true,
        terminator: "|",
      });
    } else {
      this.rewind(1);
      if (tag.tagName) {
        this.enterState(STATE.ATTRIBUTE);
      } else {
        this.enterState(STATE.TAG_NAME);
      }
    }
  },
};
