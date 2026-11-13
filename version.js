/*
  SnakeScale Notes: this file is one part of the
  multi-file split of the app that shipped as a single
  index.html through v2.112.0. The split is mechanical:
  every line here stood in the single file, in this order,
  and the parts load as classic scripts (or one stylesheet)
  in the order the shell names them, sharing one global
  scope, exactly as the single file ran. The bundle script
  in the split's harness folder reassembles the parts
  into the standalone single file copy.
*/
"use strict";

/* The single source for the app's version and build
   stamp. Through v2.112.0 these two constants stood at
   the top of section 1 of the single file's script; in
   the split they live here, in the first script the
   shell loads, so every other part reads the same two
   values and no other file hardcodes them. */
const APP_BUILD = "2026-11-13-SSN-V21520";
const APP_VERSION = "2.152.0";
