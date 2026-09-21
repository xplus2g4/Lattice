"""Table definitions. Importing this package registers every table on `Base.metadata`."""

from lattice.db.models.conversation import Feedback, Session, Turn
from lattice.db.models.identity import Course, Enrolment, User
from lattice.db.models.material import Material, ReadingPosition, Topic
from lattice.db.models.note import Note

__all__ = [
    "Course",
    "Enrolment",
    "Feedback",
    "Material",
    "Note",
    "ReadingPosition",
    "Session",
    "Topic",
    "Turn",
    "User",
]
