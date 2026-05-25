// Real-shape v0.6 board.yaml fixtures (no test() calls — safe to require from
// multiple test files without re-registering tests).

const EDGEAI = `
som:
  sku: E1M-AEN701
preset: e1m-evk
pins:
  - { e1m: E1M_I2C0, macro: EVK_I2C_BUS_SENSORS, doc: "Shared sensor bus" }
cores:
  a32_cluster:
    os: "off"
  m55_hp:
    app: ./src
    inference:
      default_arena_kib: 256
diagnostics:
  log_level: info
`;

const OBJDET = `
som:
  sku: E1M-V2M101
preset: e1m-evk
chips:
  - ov5640
  - st7789
cores:
  a55_cluster:
    os: "off"
  m33_sm:
    app: ./src
    libraries:
      - cmsis_dsp
`;

const PRODUCTION = `
som:
  sku: E1M-AEN701
preset: e1m-evk
cores:
  a32_cluster:
    os: "off"
  m55_hp:
    app: ./src
    iot: { wifi: true, mqtt: true, tls: true }
    libraries: [mbedtls]
    memory: { stack_kib: 8, heap_kib: 64, isr_stack_kib: 4 }
    power:
      sleep_mode: standby
      wakeup_sources: [uart, gpio, rtc]
  m55_he:
    os: "off"
chips:
  - optiga_trust_m
  - eeprom_24c128
boot:
  method: mcuboot
  signing: { algorithm: ecdsa_p256, key_file: keys/prod_ecdsa_p256.pub.pem }
  slots:
    primary: { size_kib: 1024 }
    secondary: { size_kib: 1024 }
  swap_algorithm: scratch
  scratch_size_kib: 64
  anti_rollback: true
ota:
  provider: mender
  artifact_name: production-deployment
  server: { url: "https://hosted.mender.io" }
  rollback: { enabled: true, retries: 3, min_version: 1 }
  poll_interval_s: 1800
diagnostics:
  log_level: info
`;

// Inline-mode board exercising the blocks the other three omit:
// populated, e1m_routes, ipc, storage, security, features, supported_boards,
// diagnostics.modules, and per-core os/image/peripherals.
const ALLBLOCKS = `
som:
  sku: E1M-V2N101
populated:
  lsm6dso: true
  bme280: false
e1m_routes:
  gpio:
    - { e1m: E1M_GPIO_IO4, macro: BTN_USER, doc: "user button", active_low: true, pull: up }
  buses:
    - { e1m: E1M_I2C0, macro: SENSOR_BUS }
cores:
  a55_cluster:
    os: yocto
    image: alp-image-edge
  m33_sm:
    app: ./fw
    peripherals: [i2c, gpio, spi]
ipc:
  - { kind: rpmsg, endpoints: [a55_cluster, m33_sm], carve_out_kb: 256, name: alp_default_rpmsg }
storage:
  - { name: appfs, size_kib: 512, fs: littlefs, flash_device: ospi0 }
security:
  psa:
    persistent_slots: 8
    tfm: true
    attestation_root: optiga_trust_m
features:
  custom_flag: true
supported_boards: [e1m-x-evk]
diagnostics:
  last_error: true
  log_level: debug
  modules:
    alp_inference: trace
`;

module.exports = { EDGEAI, OBJDET, PRODUCTION, ALLBLOCKS };
