// Copyright 2023 binepad (@binepad)
// SPDX-License-Identifier: GPL-2.0-or-later

#pragma once

/* ----- Encoder ----- */
#define ENCODER_DEFAULT_POS 0x3 // enable 1:1 resolution

// /* ----- I2C ----- */
// #define I2C1_CLOCK_SPEED 400000
// #define I2C1_DUTY_CYCLE FAST_DUTY_CYCLE_2

/* ----- OLED ----- */
#ifdef OLED_ENABLE
/* I2C (for OLED) */
#    define I2C1_SCL_PIN B6
#    define I2C1_SDA_PIN B7
#    define I2C_DRIVER I2CD1

/* Configure oled driver for the 128x32 oled */
#    define OLED_TIMEOUT (2 * 60 * 1000) // 2 minutes
#    define OLED_UPDATE_INTERVAL 66       // ~30fps
#endif // OLED_ENABLE
