# SPDX-License-Identifier: Apache-2.0
# Zephyr application entry for the m55_hp core (board.yaml: cores.m55_hp.app = ./src).
cmake_minimum_required(VERSION 3.20.0)
find_package(Zephyr REQUIRED HINTS $ENV{ZEPHYR_BASE})
project(alp_app)

target_sources(app PRIVATE
  main.c
  features/connectivity_pipeline.c
)
target_include_directories(app PRIVATE ../include)
