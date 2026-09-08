// Copyright 2023 binepad (@binepad)
// SPDX-License-Identifier: GPL-2.0-or-later

#pragma once

#include_next <mcuconf.h>

#undef STM32_I2C_USE_I2C1
#define STM32_I2C_USE_I2C1 TRUE
#define STM32_I2C_BUSY_TIMEOUT 50
#define STM32_I2C_I2C1_IRQ_PRIORITY 5
#define STM32_I2C_I2C1_DMA_PRIORITY 3
