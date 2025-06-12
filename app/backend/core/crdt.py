from typing import List, Dict, Optional
from dataclasses import dataclass
from datetime import datetime
import uuid

@dataclass
class Position:
    """Represents a position in the CRDT structure"""
    site_id: str  # Unique identifier for the user/site
    counter: int  # Local counter for ordering
    timestamp: float  # Timestamp for tie-breaking

@dataclass
class Character:
    """Represents a character in the CRDT structure"""
    value: str  # The actual character
    position: Position  # Position in the CRDT
    deleted: bool = False  # Whether the character is deleted

class CRDT:
    def __init__(self, site_id: str):
        self.site_id = site_id
        self.characters: List[Character] = []
        self.counter = 0

    def generate_position(self) -> Position:
        """Generate a new position for a character"""
        self.counter += 1
        return Position(
            site_id=self.site_id,
            counter=self.counter,
            timestamp=datetime.utcnow().timestamp()
        )

    def compare_positions(self, pos1: Position, pos2: Position) -> int:
        """Compare two positions for ordering"""
        if pos1.site_id != pos2.site_id:
            # Different sites: use timestamp for tie-breaking
            return -1 if pos1.timestamp < pos2.timestamp else 1
        # Same site: use counter
        return -1 if pos1.counter < pos2.counter else 1

    def insert(self, index: int, value: str) -> Character:
        """Insert a character at the specified index"""
        if not self.characters:
            # First character
            position = self.generate_position()
            char = Character(value=value, position=position)
            self.characters.append(char)
            return char

        # Find the position between characters
        if index == 0:
            # Insert at beginning
            position = Position(
                site_id=self.site_id,
                counter=0,
                timestamp=datetime.utcnow().timestamp()
            )
        elif index >= len(self.characters):
            # Insert at end
            position = Position(
                site_id=self.site_id,
                counter=self.characters[-1].position.counter + 1,
                timestamp=datetime.utcnow().timestamp()
            )
        else:
            # Insert between characters
            prev_pos = self.characters[index - 1].position
            next_pos = self.characters[index].position
            position = Position(
                site_id=self.site_id,
                counter=(prev_pos.counter + next_pos.counter) // 2,
                timestamp=datetime.utcnow().timestamp()
            )

        char = Character(value=value, position=position)
        self.characters.insert(index, char)
        return char

    def delete(self, index: int) -> Optional[Character]:
        """Delete a character at the specified index"""
        if 0 <= index < len(self.characters):
            char = self.characters[index]
            char.deleted = True
            return char
        return None

    def get_text(self) -> str:
        """Get the current text content"""
        return ''.join(char.value for char in self.characters if not char.deleted)

    def apply_remote_operation(self, char: Character) -> None:
        """Apply a remote operation to the CRDT"""
        # Find the correct position to insert the character
        insert_index = 0
        for i, existing_char in enumerate(self.characters):
            if self.compare_positions(existing_char.position, char.position) > 0:
                insert_index = i
                break
            insert_index = i + 1

        # Insert or update the character
        if insert_index < len(self.characters):
            self.characters.insert(insert_index, char)
        else:
            self.characters.append(char)

    def to_dict(self) -> Dict:
        """Convert CRDT state to dictionary for storage"""
        return {
            'characters': [
                {
                    'value': char.value,
                    'position': {
                        'site_id': char.position.site_id,
                        'counter': char.position.counter,
                        'timestamp': char.position.timestamp
                    },
                    'deleted': char.deleted
                }
                for char in self.characters
            ]
        }

    @classmethod
    def from_dict(cls, data: Dict, site_id: str) -> 'CRDT':
        """Create CRDT instance from dictionary"""
        crdt = cls(site_id)
        crdt.characters = [
            Character(
                value=char_data['value'],
                position=Position(
                    site_id=char_data['position']['site_id'],
                    counter=char_data['position']['counter'],
                    timestamp=char_data['position']['timestamp']
                ),
                deleted=char_data['deleted']
            )
            for char_data in data['characters']
        ]
        return crdt 