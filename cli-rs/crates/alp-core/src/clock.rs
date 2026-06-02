// SPDX-License-Identifier: Apache-2.0
//! Pure timestamp formatting. The clock *read* lives in the CLI; this module
//! only turns an epoch into an ISO-8601 string, so it stays IO-free and
//! deterministic (and therefore unit-testable).
//!
//! Output shape matches JavaScript's `new Date().toISOString()` —
//! `YYYY-MM-DDTHH:MM:SS.mmmZ` — so envelopes are byte-comparable with the
//! TypeScript CLI's `generatedAt`.

/// Format a UTC instant (seconds + milliseconds since the Unix epoch) as an
/// ISO-8601 string with millisecond precision and a `Z` suffix.
pub fn format_iso8601_utc(epoch_secs: i64, millis: u32) -> String {
    let days = epoch_secs.div_euclid(86_400);
    let secs_of_day = epoch_secs.rem_euclid(86_400);

    let (year, month, day) = civil_from_days(days);
    let hour = secs_of_day / 3_600;
    let minute = (secs_of_day % 3_600) / 60;
    let second = secs_of_day % 60;

    format!("{year:04}-{month:02}-{day:02}T{hour:02}:{minute:02}:{second:02}.{millis:03}Z")
}

/// Convert a count of days since 1970-01-01 into a (year, month, day) triple.
/// Howard Hinnant's `civil_from_days` algorithm (public domain), valid for the
/// full proleptic Gregorian range.
fn civil_from_days(z: i64) -> (i64, u32, u32) {
    let z = z + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = z - era * 146_097; // [0, 146096]
    let yoe = (doe - doe / 1_460 + doe / 36_524 - doe / 146_096) / 365; // [0, 399]
    let year = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100); // [0, 365]
    let mp = (5 * doy + 2) / 153; // [0, 11]
    let day = (doy - (153 * mp + 2) / 5 + 1) as u32; // [1, 31]
    let month = if mp < 10 { mp + 3 } else { mp - 9 } as u32; // [1, 12]
    let year = if month <= 2 { year + 1 } else { year };
    (year, month, day)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn epoch_zero_is_unix_epoch() {
        assert_eq!(format_iso8601_utc(0, 0), "1970-01-01T00:00:00.000Z");
    }

    #[test]
    fn known_instant_matches_js_to_iso_string() {
        // 1_700_000_000 == 2023-11-14T22:13:20Z (cross-checked with Date).
        assert_eq!(
            format_iso8601_utc(1_700_000_000, 0),
            "2023-11-14T22:13:20.000Z"
        );
    }

    #[test]
    fn milliseconds_are_zero_padded() {
        assert_eq!(format_iso8601_utc(0, 7), "1970-01-01T00:00:00.007Z");
    }

    #[test]
    fn handles_leap_day() {
        // 1_582_934_400 == 2020-02-29T00:00:00Z.
        assert_eq!(
            format_iso8601_utc(1_582_934_400, 0),
            "2020-02-29T00:00:00.000Z"
        );
    }
}
