// SPDX-License-Identifier: Apache-2.0

#include "app/app.h"
#include <stdio.h>

int alp_app_init(void) {
  // TODO: initialize app-level services.
  return 0;
}

int alp_app_run(void) {
  // TODO: execute one app cycle.
  return 0;
}

int main(void) {
  if (alp_app_init() != 0) {
    puts("alp_app_init failed");
    return 1;
  }

  if (alp_app_run() != 0) {
    puts("alp_app_run failed");
    return 1;
  }

  puts("ALP IoT starter boot");
  puts("TODO: connect Wi-Fi and start MQTT session");
  return 0;
}
