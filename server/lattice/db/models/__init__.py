"""Table definitions. Importing this package registers every table on `Base.metadata`."""

from lattice.db.models.identity import Course, Enrolment, User
from lattice.db.models.material import Material, ReadingPosition, Topic
from lattice.db.models.note import Note

__all__ = ["Course", "Enrolment", "Material", "Note", "ReadingPosition", "Topic", "User"]
