import { CODE, StateDefinition } from "../internal";

// We enter STATE.DTD after we encounter a "<!" while in the STATE.HTML_CONTENT.
// We leave STATE.DTD if we see a ">".
export const DTD: StateDefinition = {
  name: "DTD",

  enter() {
    this.endText();
    this.skip(1); // skip !
  },

  exit(docType) {
    this.notify("doctype", {
      pos: docType.pos,
      endPos: docType.endPos,
      value: {
        pos: docType.pos + 2, // strip <!
        endPos: docType.endPos - 1 // strip >
      }
    })
  },

  eof(docType) {
    this.notifyError(
      docType,
      "MALFORMED_DOCUMENT_TYPE",
      "EOF reached while parsing document type"
    );
  },

  char(_, code) {
    if (code === CODE.CLOSE_ANGLE_BRACKET) {
      this.exitState(">");
    }
  },
};
