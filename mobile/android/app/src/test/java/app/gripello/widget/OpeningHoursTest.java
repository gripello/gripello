package app.gripello.widget;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import java.util.Calendar;
import org.junit.Test;

public class OpeningHoursTest {

    // 2026-10-19 is a Monday.
    private static Calendar at(int dayOfMonth, int hour, int minute) {
        Calendar calendar = Calendar.getInstance();
        calendar.clear();
        calendar.set(2026, Calendar.OCTOBER, dayOfMonth, hour, minute);
        return calendar;
    }

    @Test
    public void noHoursHasNoStatus() {
        assertNull(OpeningHours.status(null, at(19, 10, 0)));
        assertNull(OpeningHours.status("{}", at(19, 10, 0)));
        assertNull(OpeningHours.status("not json", at(19, 10, 0)));
    }

    @Test
    public void openInsideAnInterval() {
        OpeningHours.Status status = OpeningHours.status("{\"mon\":[[\"09:00\",\"22:00\"]]}", at(19, 10, 0));
        assertTrue(status.open);
        assertEquals("22:00", status.time);
        assertEquals(-1, status.day);
    }

    @Test
    public void closesAtTheEndOfTheInterval() {
        OpeningHours.Status status = OpeningHours.status("{\"mon\":[[\"09:00\",\"22:00\"]]}", at(19, 22, 0));
        assertFalse(status.open);
    }

    @Test
    public void opensLaterTodayAtTheEarliestStart() {
        OpeningHours.Status status = OpeningHours.status("{\"mon\":[[\"17:00\",\"22:00\"],[\"09:00\",\"12:00\"]]}", at(19, 7, 0));
        assertFalse(status.open);
        assertEquals("09:00", status.time);
        assertEquals(-1, status.day);
    }

    @Test
    public void opensOnTheNextDayWithHours() {
        OpeningHours.Status status = OpeningHours.status("{\"mon\":[[\"09:00\",\"22:00\"]],\"wed\":[[\"14:00\",\"22:00\"],[\"10:00\",\"12:00\"]]}", at(19, 23, 0));
        assertFalse(status.open);
        assertEquals("10:00", status.time);
        assertEquals(2, status.day);
    }

    @Test
    public void opensNextWeekOnTheSameWeekday() {
        OpeningHours.Status status = OpeningHours.status("{\"mon\":[[\"09:00\",\"12:00\"]]}", at(19, 13, 0));
        assertEquals("09:00", status.time);
        assertEquals(0, status.day);
    }

    @Test
    public void staysOpenPastMidnightOnTheSameDay() {
        OpeningHours.Status status = OpeningHours.status("{\"mon\":[[\"18:00\",\"02:00\"]]}", at(19, 23, 30));
        assertTrue(status.open);
        assertEquals("02:00", status.time);
    }

    @Test
    public void staysOpenPastMidnightIntoTheNextDay() {
        // Saturday 01:00 after a Friday night session.
        OpeningHours.Status status = OpeningHours.status("{\"fri\":[[\"18:00\",\"02:00\"]]}", at(24, 1, 0));
        assertTrue(status.open);
        assertEquals("02:00", status.time);
        assertFalse(OpeningHours.status("{\"fri\":[[\"18:00\",\"02:00\"]]}", at(24, 2, 0)).open);
    }

    @Test
    public void onlyHolidayHoursShowClosed() {
        OpeningHours.Status status = OpeningHours.status("{\"holiday\":[[\"10:00\",\"18:00\"]]}", at(19, 10, 0));
        assertFalse(status.open);
        assertEquals("", status.time);
    }
}
