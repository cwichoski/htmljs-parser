import {
  CODE,
  StateDefinition,
  Parser,
} from "../internal";

// We enter STATE.CDATA after we see "<![CDATA["
export const CDATA: StateDefinition = {
  name: "CDATA",

  enter() {
    this.endText();
    this.textParseMode = "cdata";
    this.skip(8); // skip ![CDATA[
  },

  exit(cdata) {
    this.notify("cdata", {
      pos: cdata.pos,
      endPos: cdata.endPos,
      value: {
        pos: cdata.pos + 8, // strip <![CDATA[
        endPos: cdata.endPos - 3, // strip ]]>
      },
    });
  },

  eof(cdata) {
    this.notifyError(
      cdata,
      "MALFORMED_CDATA",
      "EOF reached while parsing CDATA"
    );
  },

  char(_, code) {
    if (code === CODE.CLOSE_SQUARE_BRACKET && this.lookAheadFor("]>")) {
      this.exitState("]]>");
      return;
    }
  },
};

export function checkForCDATA(parser: Parser) {
  if (parser.lookAheadFor("<![CDATA[", parser.pos)) {
    parser.enterState(CDATA);
    return true;
  }

  return false;
}
